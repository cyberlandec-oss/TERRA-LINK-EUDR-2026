import { SOAP_ENV_NS, securityHeader, xmlEscape, type SecurityHeaderOptions, type ServiceCredentials } from './ws-security';
import { fetchTransport, type Environment, type SoapTransport } from './echo';

// P1-007 tramo 2 — Servicio DDS de EUDR-IS (TRACES NT): mensaje `submitDds`, consulta `getDds`/`getDdsByInternalReference` e interpretación de las respuestas.
// Contratos leídos de los WSDL/XSD públicos el 2026-11-01 (docs/operacion/CONEXION_EUDR_IS.md):
//   · ACCEPTANCE publica V3 y V4; PRODUCTION publica SOLO V3 (el WSDL V4 de producción responde 404). Se usa V4 en ACCEPTANCE y V3 en PRODUCTION.
//   · La estructura de `submitDds` es la misma; cambian los espacios de nombres (…/v3 o …/v4, común y de cuerpo) y V4 admite omitir `geometryGeojson` (geolocalización confidencial) y añade
//     `geometryData`. El espacio de nombres de la cabecera base (`…/sanco/tracesnt/base/v4`) no cambia.
//   · `getDdsByIdentifiers` ya no devuelve contenido en ninguna versión: aquí no se usa.
//   · ACCEPTANCE y PRODUCTION NO se comportan igual (ventana de enmienda, bloqueo aduanero): cada entorno se trata por separado.
// Lo que este módulo NO hace: decidir si algo se presenta (eso lo gobierna el servicio con sus compuertas), ni reintentar. Una respuesta que no se pueda interpretar es INCIERTA
// y NUNCA se reenvía sola: se concilia por referencia interna (ver eudr-is-submissions.ts).
export type DdsVersion = 'V3' | 'V4';
export const DDS_ENDPOINTS: Record<Environment, Partial<Record<DdsVersion, string>>> = {
  ACCEPTANCE: {
    V3: 'https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EUDRDueDiligenceStatementServiceV3',
    V4: 'https://acceptance.eudr.webcloud.ec.europa.eu/tracesnt/ws/EUDRDueDiligenceStatementServiceV4',
  },
  PRODUCTION: { V3: 'https://eudr.webcloud.ec.europa.eu/tracesnt/ws/EUDRDueDiligenceStatementServiceV3' },
};
/** Versión que se usa en cada entorno: la más reciente que el entorno publica. */
export const ddsVersionFor = (env: Environment): DdsVersion => (DDS_ENDPOINTS[env].V4 ? 'V4' : 'V3');

const NS = (v: DdsVersion) => ({
  dds: `http://ec.europa.eu/tracesnt/certificate/eudr/due-diligence-statement/${v === 'V4' ? 'v4' : 'v3'}`,
  common: `http://ec.europa.eu/tracesnt/certificate/eudr/common/${v === 'V4' ? 'v4' : 'v3'}`,
});
const soapAction = (v: DdsVersion, op: string) => `${NS(v).dds}/${op}`;

export type ActivityType = 'IMPORT' | 'EXPORT' | 'DOMESTIC';
export type OperatorRole = 'OPERATOR' | 'REPRESENTATIVE_OPERATOR';
export interface DdsProducerInput {
  country: string; name?: string | null;
  /** Geometría WGS84 [lon, lat] de la parcela de origen (Point o Polygon). */
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'Polygon'; coordinates: number[][][] };
  /** Hectáreas de la parcela: un punto solo se admite hasta 4 ha. */
  area_ha?: number | null; production_place?: string | null;
}
export interface DdsInput {
  operator_role: OperatorRole; activity_type: ActivityType;
  country_of_activity?: string | null; border_cross_country?: string | null;
  internal_reference: string;
  represented_operator?: { name: string; reference_type?: string | null; reference_value?: string | null } | null;
  commodity: { hs_heading: string; description: string; net_weight_kg: string; species_scientific_name?: string | null; species_common_name?: string | null };
  producers: DdsProducerInput[];
  geolocation_confidential: boolean;
  comment?: string | null;
}

const ISO2 = /^[A-Za-z]{2}$/;
/** Problemas del contenido declarado, en español y por campo; vacío = puede construirse el mensaje. No inventa ni completa nada. */
export function validateDdsInput(i: DdsInput, v: DdsVersion): Array<{ field: string; message: string }> {
  const p: Array<{ field: string; message: string }> = [];
  const add = (field: string, message: string) => p.push({ field, message });
  if (!['OPERATOR', 'REPRESENTATIVE_OPERATOR'].includes(i.operator_role)) add('operator_role', 'El rol debe ser OPERATOR o REPRESENTATIVE_OPERATOR.');
  if (i.operator_role === 'REPRESENTATIVE_OPERATOR' && !i.represented_operator?.name) add('represented_operator', 'Un representante autorizado debe identificar al operador representado.');
  if (!['IMPORT', 'EXPORT', 'DOMESTIC'].includes(i.activity_type)) add('activity_type', 'La actividad debe ser IMPORT, EXPORT o DOMESTIC.');
  if (i.country_of_activity && !ISO2.test(i.country_of_activity)) add('country_of_activity', 'El país de la actividad debe ser un código ISO 3166-1 de dos letras.');
  if (i.border_cross_country && !ISO2.test(i.border_cross_country)) add('border_cross_country', 'El país de cruce de frontera debe ser un código ISO 3166-1 de dos letras.');
  if (!i.internal_reference || i.internal_reference.length > 50) add('internal_reference', 'La referencia interna es obligatoria y tiene hasta 50 caracteres.');
  if (!/^\d{2,10}$/.test(i.commodity.hs_heading)) add('commodity.hs_heading', 'El código HS debe tener de 2 a 10 dígitos (cacao: capítulo 18; no se deduce por el producto).');
  if (!i.commodity.description || i.commodity.description.length > 150) add('commodity.description', 'La descripción comercial es obligatoria y tiene hasta 150 caracteres.');
  const w = Number(i.commodity.net_weight_kg);
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(i.commodity.net_weight_kg) || !(w > 0)) add('commodity.net_weight_kg', 'La masa neta en kg es obligatoria (mayor que cero, hasta 6 decimales).');
  if (!i.producers.length) add('producers', 'Debe declararse al menos un productor con la geolocalización de su parcela.');
  i.producers.forEach((pr, k) => {
    if (!ISO2.test(pr.country ?? '')) add(`producers[${k}].country`, 'El país de producción debe ser un código ISO 3166-1 de dos letras (un país desconocido no se completa).');
    if (pr.name && pr.name.length > 500) add(`producers[${k}].name`, 'El nombre del productor admite hasta 500 caracteres.');
    const g = pr.geometry;
    if (!g || (g.type !== 'Point' && g.type !== 'Polygon')) add(`producers[${k}].geometry`, 'La geometría debe ser Point o Polygon.');
    else if (g.type === 'Point' && (pr.area_ha == null || pr.area_ha > 4)) add(`producers[${k}].geometry`, 'Un punto solo se admite para parcelas de hasta 4 ha con la superficie declarada; para más superficie se exige un polígono.');
    else if (g.type === 'Polygon') {
      const ring = g.coordinates?.[0] ?? [];
      if (ring.length < 4 || ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) add(`producers[${k}].geometry`, 'El polígono debe tener al menos 4 posiciones y cerrarse.');
    }
  });
  if (v === 'V3' && i.geolocation_confidential) add('geolocation_confidential', 'V3 exige la geometría de cada productor: no admite omitirla por confidencialidad (V4 sí).');
  return p;
}

const c6 = (n: number) => n.toFixed(6);
/** GeoJSON Tipo I (servicios web): FeatureCollection con una característica y las propiedades opcionales; coordenadas con 6 decimales (el mismo valor, sin inventar precisión). */
export function producerGeoJson(pr: DdsProducerInput): string {
  const g = pr.geometry;
  const geom = g.type === 'Point'
    ? `{"type":"Point","coordinates":[${c6(g.coordinates[0])},${c6(g.coordinates[1])}]}`
    : `{"type":"Polygon","coordinates":[${g.coordinates.map((r) => `[${r.map((q) => `[${c6(q[0])},${c6(q[1])}]`).join(',')}]`).join(',')}]}`;
  const props: Record<string, unknown> = { ProducerCountry: pr.country.toUpperCase() };
  if (pr.name) props.ProducerName = pr.name;
  if (pr.production_place) props.ProductionPlace = pr.production_place;
  if (g.type === 'Point' && pr.area_ha != null) props.Area = pr.area_ha;
  return `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":${geom},"properties":${JSON.stringify(props)}}]}`;
}
export const producerGeoJsonBase64 = (pr: DdsProducerInput) => Buffer.from(producerGeoJson(pr), 'utf8').toString('base64'); // sin saltos de línea: el servicio rechaza el Base64 con líneas de 76 caracteres

const el = (ns: string, name: string, value: string | number) => `<${ns}:${name}>${xmlEscape(String(value))}</${ns}:${name}>`;

export function submitDdsBody(v: DdsVersion, i: DdsInput): string {
  const n = NS(v);
  const rep = i.represented_operator
    ? `<dds:representedOperator>${i.represented_operator.reference_type && i.represented_operator.reference_value ? `<eudrCommon:operatorReferenceNumber>${el('eudrCommon', 'identifierType', i.represented_operator.reference_type)}${el('eudrCommon', 'identifierValue', i.represented_operator.reference_value)}</eudrCommon:operatorReferenceNumber>` : ''}${el('eudrCommon', 'operatorName', i.represented_operator.name)}</dds:representedOperator>`
    : '';
  const producers = i.producers.map((pr, k) => `<dds:producers>${el('dds', 'position', k + 1)}${el('dds', 'country', pr.country.toUpperCase())}${pr.name ? el('dds', 'name', pr.name) : ''}${v === 'V4' && i.geolocation_confidential ? '' : el('dds', 'geometryGeojson', producerGeoJsonBase64(pr))}</dds:producers>`).join('');
  const species = i.commodity.species_scientific_name || i.commodity.species_common_name
    ? `<dds:speciesInfo>${i.commodity.species_scientific_name ? el('dds', 'scientificName', i.commodity.species_scientific_name) : ''}${i.commodity.species_common_name ? el('dds', 'commonName', i.commodity.species_common_name) : ''}</dds:speciesInfo>` : '';
  void n;
  return `<dds:SubmitDdsRequest>${el('dds', 'operatorRole', i.operator_role)}<dds:statement>`
    + el('dds', 'internalReferenceNumber', i.internal_reference)
    + el('dds', 'activityType', i.activity_type)
    + rep
    + (i.country_of_activity ? el('dds', 'countryOfActivity', i.country_of_activity.toUpperCase()) : '')
    + (i.border_cross_country ? el('dds', 'borderCrossCountry', i.border_cross_country.toUpperCase()) : '')
    + (i.comment ? el('dds', 'comment', i.comment) : '')
    + `<dds:commodities>${el('dds', 'position', 1)}<dds:descriptors>${el('eudrCommon', 'descriptionOfGoods', i.commodity.description)}<eudrCommon:goodsMeasure>${el('eudrCommon', 'netWeight', i.commodity.net_weight_kg)}</eudrCommon:goodsMeasure></dds:descriptors>${el('dds', 'hsHeading', i.commodity.hs_heading)}${species}${producers}</dds:commodities>`
    + el('dds', 'geoLocationConfidential', i.geolocation_confidential ? 'true' : 'false')
    + `</dds:statement></dds:SubmitDdsRequest>`;
}

function envelope(v: DdsVersion, c: ServiceCredentials, body: string, o: SecurityHeaderOptions): string {
  const n = NS(v);
  return `<soapenv:Envelope xmlns:soapenv="${SOAP_ENV_NS}" xmlns:base="http://ec.europa.eu/sanco/tracesnt/base/v4" xmlns:dds="${n.dds}" xmlns:eudrCommon="${n.common}">`
    + `<soapenv:Header>${securityHeader(c, o)}</soapenv:Header><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
}
export const submitDdsEnvelope = (v: DdsVersion, c: ServiceCredentials, i: DdsInput, o: SecurityHeaderOptions = {}) => envelope(v, c, submitDdsBody(v, i), o);
export const getDdsEnvelope = (v: DdsVersion, c: ServiceCredentials, uuid: string, o: SecurityHeaderOptions = {}) => envelope(v, c, `<dds:GetDdsRequest>${el('dds', 'uuidList', uuid)}</dds:GetDdsRequest>`, o);
export const getDdsByInternalReferenceEnvelope = (v: DdsVersion, c: ServiceCredentials, ref: string, o: SecurityHeaderOptions = {}) => envelope(v, c, `<dds:GetDdsByInternalReferenceRequest>${el('dds', 'internalReference', ref)}</dds:GetDdsByInternalReferenceRequest>`, o);

// ── Interpretación ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tag = (xml: string, name: string) => new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}(?:\\s[^>]*)?>([^<]*)<`).exec(xml)?.[1]?.trim() ?? null;
const limpiar = (s: string | null, max = 300) => (s ? s.replace(/[^\p{L}\p{N} .,:;()_\-/]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : null);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type SubmitOutcome =
  | { kind: 'ACCEPTED'; uuid: string; httpStatus: number }
  /** El sistema procesó la solicitud y la rechazó por reglas de negocio: NO hay declaración; se corrige y se vuelve a enviar con un acto explícito. */
  | { kind: 'REJECTED'; httpStatus: number; errors: Array<{ id: string | null; field: string | null; message: string | null }> }
  /** Credenciales o permiso: la solicitud no fue procesada. */
  | { kind: 'NOT_PROCESSED'; httpStatus: number | null; reason: 'AUTH_FAILED' | 'PERMISSION_DENIED' }
  /** No se puede afirmar si el sistema la recibió (tiempo agotado, corte, 5xx, respuesta ilegible): NUNCA se reenvía sola; se concilia. */
  | { kind: 'UNCERTAIN'; httpStatus: number | null; detail: string | null };

export function interpretSubmit(status: number, text: string): SubmitOutcome {
  const fault = /<(?:[A-Za-z0-9_-]+:)?Fault[\s>]/.test(text);
  if (fault) {
    if (/PermissionDeniedException/.test(text)) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'PERMISSION_DENIED' };
    if (status === 401 || /authentication|unauthor|credential|security token|usernametoken/i.test(tag(text, 'faultstring') ?? '')) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'AUTH_FAILED' };
    if (/BusinessRulesValidationException|InvalidParametersException/.test(text)) {
      const errors: Array<{ id: string | null; field: string | null; message: string | null }> = [];
      for (const m of text.matchAll(/<(?:[A-Za-z0-9_-]+:)?Error>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?Error>/g)) errors.push({ id: limpiar(tag(m[1], 'ID'), 60), field: limpiar(tag(m[1], 'Field'), 120), message: limpiar(tag(m[1], 'Message')) });
      return { kind: 'REJECTED', httpStatus: status, errors };
    }
    return { kind: 'UNCERTAIN', httpStatus: status, detail: limpiar(tag(text, 'faultstring')) }; // p. ej. InternalSystemException sin detalle
  }
  if (status === 401 || status === 403) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'AUTH_FAILED' };
  const uuid = tag(text, 'uuid');
  if (status >= 200 && status < 300 && uuid && UUID.test(uuid)) return { kind: 'ACCEPTED', uuid: uuid.toLowerCase(), httpStatus: status };
  return { kind: 'UNCERTAIN', httpStatus: status, detail: 'Respuesta no interpretable' };
}

export interface DdsOverview { uuid: string; internalReference: string | null; referenceNumber: string | null; verificationNumber: string | null; status: string | null; rejectionReason: string | null; referenceNumberInfo: string | null; version: number | null }
export type OverviewOutcome =
  | { kind: 'FOUND'; httpStatus: number; items: DdsOverview[] }
  | { kind: 'NOT_FOUND'; httpStatus: number }
  | { kind: 'NOT_PROCESSED'; httpStatus: number | null; reason: 'AUTH_FAILED' | 'PERMISSION_DENIED' }
  | { kind: 'UNCERTAIN'; httpStatus: number | null; detail: string | null };

export function interpretOverview(status: number, text: string): OverviewOutcome {
  if (/<(?:[A-Za-z0-9_-]+:)?Fault[\s>]/.test(text)) {
    if (/NotFoundException/.test(text)) return { kind: 'NOT_FOUND', httpStatus: status };
    if (/PermissionDeniedException/.test(text)) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'PERMISSION_DENIED' };
    if (status === 401 || /authentication|unauthor|credential|security token|usernametoken/i.test(tag(text, 'faultstring') ?? '')) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'AUTH_FAILED' };
    return { kind: 'UNCERTAIN', httpStatus: status, detail: limpiar(tag(text, 'faultstring')) };
  }
  if (status === 401 || status === 403) return { kind: 'NOT_PROCESSED', httpStatus: status, reason: 'AUTH_FAILED' };
  if (status >= 200 && status < 300 && /ddsOverviewList|Response/.test(text)) {
    const items: DdsOverview[] = [];
    for (const m of text.matchAll(/<(?:[A-Za-z0-9_-]+:)?ddsOverviewList>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?ddsOverviewList>/g)) {
      const b = m[1];
      const uuid = tag(b, 'uuid');
      if (!uuid || !UUID.test(uuid)) continue;
      items.push({ uuid: uuid.toLowerCase(), internalReference: limpiar(tag(b, 'internalReferenceNumber'), 50), referenceNumber: limpiar(tag(b, 'referenceNumber'), 14), verificationNumber: limpiar(tag(b, 'verificationNumber'), 40), status: limpiar(tag(b, 'status'), 20), rejectionReason: limpiar(tag(b, 'rejectionReason')), referenceNumberInfo: limpiar(tag(b, 'referenceNumberInfo')), version: tag(b, 'version') ? Number(tag(b, 'version')) : null });
    }
    return items.length ? { kind: 'FOUND', httpStatus: status, items } : { kind: 'NOT_FOUND', httpStatus: status };
  }
  return { kind: 'UNCERTAIN', httpStatus: status, detail: 'Respuesta no interpretable' };
}

// ── Llamadas (transporte inyectable; en las pruebas nunca sale de la máquina) ───────────────────────────────────────────────────────────────────
async function call(env: Environment, v: DdsVersion, op: string, xml: string, transport: SoapTransport): Promise<{ status: number; text: string } | null> {
  const url = DDS_ENDPOINTS[env][v];
  if (!url) throw new Error('DDS_VERSION_NOT_PUBLISHED_FOR_ENVIRONMENT');
  try { return await transport(url, { headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${soapAction(v, op)}"` }, body: xml, timeoutMs: 60_000 }); } catch { return null; }
}
export async function sendSubmitDds(env: Environment, v: DdsVersion, c: ServiceCredentials, i: DdsInput, transport: SoapTransport = fetchTransport, o: SecurityHeaderOptions = {}): Promise<SubmitOutcome> {
  const r = await call(env, v, 'submitDds', submitDdsEnvelope(v, c, i, o), transport);
  return r ? interpretSubmit(r.status, r.text) : { kind: 'UNCERTAIN', httpStatus: null, detail: 'Sin respuesta (tiempo agotado o conexión interrumpida)' };
}
export async function sendGetDds(env: Environment, v: DdsVersion, c: ServiceCredentials, uuid: string, transport: SoapTransport = fetchTransport, o: SecurityHeaderOptions = {}): Promise<OverviewOutcome> {
  const r = await call(env, v, 'getDds', getDdsEnvelope(v, c, uuid, o), transport);
  return r ? interpretOverview(r.status, r.text) : { kind: 'UNCERTAIN', httpStatus: null, detail: 'Sin respuesta (tiempo agotado o conexión interrumpida)' };
}
export async function sendGetByInternalReference(env: Environment, v: DdsVersion, c: ServiceCredentials, ref: string, transport: SoapTransport = fetchTransport, o: SecurityHeaderOptions = {}): Promise<OverviewOutcome> {
  const r = await call(env, v, 'getDdsByInternalReference', getDdsByInternalReferenceEnvelope(v, c, ref, o), transport);
  return r ? interpretOverview(r.status, r.text) : { kind: 'UNCERTAIN', httpStatus: null, detail: 'Sin respuesta (tiempo agotado o conexión interrumpida)' };
}
