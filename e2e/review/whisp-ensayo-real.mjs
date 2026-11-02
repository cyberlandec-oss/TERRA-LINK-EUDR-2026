// P0-028 — ENSAYO REAL de integración con Whisp 2.3.1 usando UNA GEOMETRÍA ARTIFICIAL. NO se ejecuta solo ni en validate.
//
//   node e2e/review/whisp-ensayo-real.mjs --simular      # muestra qué se enviaría; NO abre ninguna conexión
//   WHISP_API_KEY=… WHISP_ENSAYO_AUTORIZADO=SI_TERMINOS_ACEPTADOS_POR_EL_PROPIETARIO node e2e/review/whisp-ensayo-real.mjs
//
// Se niega a correr sin las DOS condiciones: (1) una clave de API de Whisp propia del propietario y (2) su autorización expresa, que implica que
// aceptó él mismo los términos del servicio (https://whisp.openforis.org/legal/terms-of-service). Terra Link NO acepta términos por él, NO usa parcelas
// reales, NO envía nombres, códigos ni identificadores (`properties` va vacío) y NO escribe nada en la base: solo guarda la respuesta cruda en
// validation-results/ (la clave se lee del entorno y nunca se imprime ni se guarda). Whisp conserva los resultados ~10 min: aquí se guarda la copia.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// La clave se lee del entorno o, si no está, SOLO la variable WHISP_API_KEY del archivo local `.env` (ignorado por git). Nunca se imprime.
if (!process.env.WHISP_API_KEY) {
  try {
    const { readFileSync } = await import('node:fs');
    const m = readFileSync('.env', 'utf8').match(/^WHISP_API_KEY=(.+)$/m);
    if (m && m[1].trim()) process.env.WHISP_API_KEY = m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* sin .env */ }
}
const BASE = process.env.WHISP_BASE_URL ?? 'https://whisp.openforis.org';
// Cuadrado de ~100 m ARTIFICIAL (no corresponde a ninguna parcela ni persona); en una zona agrícola cacaotera de Ecuador para que el análisis sea representativo.
const GEOMETRIA = { type: 'Polygon', coordinates: [[[-79.4000, -1.0000], [-79.3991, -1.0000], [-79.3991, -0.9991], [-79.4000, -0.9991], [-79.4000, -1.0000]]] };
const cuerpo = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: GEOMETRIA }], analysisOptions: { async: true } };

if (process.argv.includes('--simular')) {
  console.log(`SIMULACIÓN (sin red). Destino: ${BASE}\n  GET  /api/config\n  POST /api/submit/geojson  (cabecera x-api-key)\n  [202] GET /api/status/{data.token} hasta analysis_completed (analysisOptions.async=true, como el adaptador)\n  [si el resultado no viene] GET /api/generate-geojson/{data.token}\nCuerpo:\n${JSON.stringify(cuerpo, null, 1)}`);
  process.exit(0);
}
const clave = process.env.WHISP_API_KEY;
if (!clave || process.env.WHISP_ENSAYO_AUTORIZADO !== 'SI_TERMINOS_ACEPTADOS_POR_EL_PROPIETARIO') {
  console.error('NO SE EJECUTA. Falta:' + (!clave ? '\n  - WHISP_API_KEY: la clave de API del propietario (se crea en su cuenta de https://whisp.openforis.org, inicio de sesión FAO; vale 365 días y solo hay una activa).' : '')
    + (process.env.WHISP_ENSAYO_AUTORIZADO !== 'SI_TERMINOS_ACEPTADOS_POR_EL_PROPIETARIO' ? '\n  - WHISP_ENSAYO_AUTORIZADO=SI_TERMINOS_ACEPTADOS_POR_EL_PROPIETARIO: su autorización expresa de enviar esta geometría ARTIFICIAL, habiendo aceptado él los términos.' : ''));
  process.exit(2);
}
const pedir = async (ruta, init = {}) => {
  const r = await fetch(BASE + ruta, { ...init, headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.auth ? { 'x-api-key': clave } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(120000) });
  const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ }
  return { status: r.status, texto, json };
};
const sal = join('validation-results', `whisp-ensayo-real-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(sal, { recursive: true });
const etapas = [];
const POLL_MS = Number(process.env.WHISP_POLL_MS ?? 3000);
const MAX_POLLS = Number(process.env.WHISP_MAX_POLLS ?? 200);
const anotar = (etapa, r, extra = {}) => { etapas.push({ etapa, http: r?.status ?? null, code: r?.json?.code ?? null, ...extra }); console.log(etapa, r?.status ?? '', r?.json?.code ?? '', extra.percent ?? ''); };
class Fin extends Error { constructor(codigo) { super('fin'); this.codigo = codigo; } }
// No se usa process.exit(): en Windows, salir con conexiones HTTP abiertas aborta el proceso (0xC0000409). Se termina por excepción y se deja salir al proceso.
const terminar = (codigo, motivo) => {
  writeFileSync(join(sal, 'etapas.json'), `${JSON.stringify({ base: BASE, motivo, etapas }, null, 2)}\n`);
  if (motivo) console.error(`TERMINA SIN RESULTADO: ${motivo}. Un fallo o un trabajo incompleto NO es «sin deforestación».`);
  throw new Fin(codigo);
};

try {
// 1) Configuración y límites ANTES de enviar nada: si no son utilizables, no sale la geometría.
const cfg = await pedir('/api/config');
anotar('config', cfg);
if (cfg.status !== 200 || typeof cfg.json?.geometryLimitSync !== 'number') terminar(1, 'la configuración publicada por el proveedor no es utilizable; no se envió ninguna geometría');
const kb = Buffer.byteLength(JSON.stringify(cuerpo), 'utf8') / 1024;
if (typeof cfg.json.maxRequestBodySizeKb === 'number' && kb > cfg.json.maxRequestBodySizeKb) terminar(1, 'la solicitud supera el tamaño máximo que declara el proveedor; no se envió');

// 2) Envío.
let r = await pedir('/api/submit/geojson', { method: 'POST', body: JSON.stringify(cuerpo), auth: true });
anotar('submit', r);
if (r.status >= 400) terminar(1, `el proveedor rechazó el envío (HTTP ${r.status}, ${r.json?.code ?? 'sin código'})`);
const token = r.json?.data?.token ?? null;

// 3) Seguimiento hasta un estado TERMINAL. Terminales: completado, error, plazo, cancelado, trabajo desconocido o cualquier HTTP de error.
const TERMINALES_SIN_RESULTADO = new Set(['analysis_error', 'analysis_timeout', 'analysis_cancelled', 'analysis_job_not_found']);
const PROGRESO = new Set(['analysis_queued', 'analysis_processing']);
if (token && r.json?.code !== 'analysis_completed') {
  let terminado = false;
  for (let i = 0; i < MAX_POLLS && !terminado; i++) {
    await new Promise((ok) => setTimeout(ok, POLL_MS));
    r = await pedir(`/api/status/${encodeURIComponent(token)}`, { auth: true });
    anotar('estado', r, { percent: r.json?.data?.percent ?? null });
    const code = r.json?.code ?? '';
    if (r.status >= 400 || TERMINALES_SIN_RESULTADO.has(code) || code.startsWith('validation_')) terminar(1, `el proveedor terminó sin resultado (HTTP ${r.status}, ${code || 'sin código'})`);
    if (code === 'analysis_completed') terminado = true;
    else if (!PROGRESO.has(code)) terminar(1, `estado fuera del contrato (${code || 'sin código'})`);
  }
  if (!terminado) terminar(1, 'el trabajo seguía en proceso tras el máximo de consultas');
}

// 4) Si el estado terminó sin traer el resultado, se descarga por el endpoint publicado para eso (igual que el adaptador).
const esFC = (v) => v && typeof v === 'object' && Array.isArray(v.features);
if (token && !esFC(r.json?.data)) {
  const dl = await pedir(`/api/generate-geojson/${encodeURIComponent(token)}`);
  anotar('descarga', dl);
  if (dl.status !== 200 || !dl.json) terminar(1, `la descarga alternativa falló (HTTP ${dl.status})`);
  r = { ...dl, json: esFC(dl.json?.data) ? dl.json : { code: 'analysis_completed', data: dl.json } };
}

// 5) Validación por contrato: FeatureCollection con una parcela analizada y sus propiedades. La mera presencia de `properties` no basta.
writeFileSync(join(sal, 'respuesta.json'), r.texto);
const props = esFC(r.json?.data) && r.json.data.features.length >= 1 && typeof r.json.data.features[0]?.properties === 'object' ? r.json.data.features[0].properties : null;
console.log(`respuesta guardada en ${sal}/respuesta.json (sha256 ${createHash('sha256').update(r.texto).digest('hex').slice(0, 16)}…)`);
if (!props) terminar(1, 'la respuesta no es un resultado conforme al contrato (sin FeatureCollection con una parcela analizada)');
console.log({ risk_pcrop: props.risk_pcrop ?? '(no informado)', metadata: props.whisp_processing_metadata ?? '(no informada)' });
terminar(0, null);
} catch (e) {
  if (e instanceof Fin) process.exitCode = e.codigo; else throw e;
}
