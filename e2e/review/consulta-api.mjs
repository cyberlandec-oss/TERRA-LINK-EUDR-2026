// Consulta de LECTURA a la API con una cuenta DEMO, sin sacar secretos por consola.
//
//   node e2e/review/consulta-api.mjs <cuenta> <consulta> [organización] [--base http://localhost:4000]
//
// Sustituye al procedimiento manual que llevaba a imprimir `CREDENCIALES.csv` para copiar una contraseña a un
// `curl`. Aquí la contraseña **se lee del archivo y se usa**, nunca se escribe en la salida; el token tampoco
// sale: vive en memoria y se descarta al terminar.
//
// La salida se limita a campos autorizados: cuenta, organización, rol y el resultado de la consulta. El filtro es
// una **lista de permitidos** declarada por consulta (`campos`): lo que no esté en ella no se publica, aunque la
// API empiece a devolverlo mañana. Una lista negra no vale para esto — solo detiene lo que alguien se acordó de
// prohibir —, así que se conserva únicamente como **segunda barrera** sobre lo ya filtrado.
//
// Ejemplos:
//   node e2e/review/consulta-api.mjs admin.cooperativa indicadores
//   node e2e/review/consulta-api.mjs admin.cooperativa riesgo "DEMO · Cooperativa Río Verde"
//   node e2e/review/consulta-api.mjs --listar-consultas
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Segunda barrera: aunque una clave llegue a estar permitida por error, si se llama así no se publica.
 * **No es el filtro principal** — eso es `permitir()` —, sino una red por si alguien amplía una lista sin pensar.
 */
const BLOQUEADOS = /(contrasena|password|passwd|access_token|refresh_token|token|secret|api_?key|authorization|credential|document_number|phone|email|_enc$|_bidx$)/i;

function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false; const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x)) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * Archivo de credenciales vigente: el **más reciente** de los dos.
 *
 * `CREDENCIALES.pendiente.csv` se escribe cuando el principal está abierto en otro programa, y entonces el
 * principal se queda obsoleto. Es la misma regla que usan el seed y `revision-por-rol.mjs`.
 */
export function archivoVigente(dir = root) {
  const files = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv']
    .map((f) => join(dir, f)).filter(existsSync)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) throw new Error('No hay archivo de credenciales DEMO en el repositorio.');
  return files[0];
}

/** Devuelve { email, contrasena, rol, organizacion } de la cuenta. La contraseña NO se imprime nunca. */
export function cuentaDemo(local, dir = root) {
  const filas = parseCsv(readFileSync(archivoVigente(dir), 'utf8'));
  const fila = filas.find((f) => f.email && f.email.split('@')[0] === local);
  if (!fila) throw new Error(`La cuenta «${local}» no está en el archivo de credenciales vigente.`);
  if (!fila.contrasena) throw new Error(`La cuenta «${local}» no tiene credencial conocida: no se puede consultar.`);
  return fila;
}

/** Segunda barrera: quita de la salida cualquier clave que *parezca* sensible, a cualquier profundidad. */
export function sanear(valor) {
  if (Array.isArray(valor)) return valor.map(sanear);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor)
      .filter(([k]) => !BLOQUEADOS.test(k))
      .map(([k, v]) => [k, sanear(v)]));
  }
  return valor;
}

/**
 * Filtro principal: **lista de permitidos**. De cada objeto se conservan solo las claves declaradas, y nada más;
 * un campo nuevo que aparezca en la respuesta se descarta por omisión en vez de publicarse.
 *
 * Los valores permitidos deben ser escalares (texto, número, booleano o nulo). Si uno llega como objeto o lista
 * —porque la API cambió de forma—, **no se publica su contenido**: se sustituye por `"[omitido: no escalar]"`.
 * Así un campo que hoy es `"OK"` y mañana es `{ valor, detalle_interno }` no cuela el detalle.
 */
export function permitir(valor, campos) {
  if (Array.isArray(valor)) return valor.map((v) => permitir(v, campos));
  if (!valor || typeof valor !== 'object') return valor;
  const out = {};
  for (const k of campos) {
    if (!Object.prototype.hasOwnProperty.call(valor, k)) continue;
    const v = valor[k];
    out[k] = v === null || ['string', 'number', 'boolean'].includes(typeof v) ? v : '[omitido: no escalar]';
  }
  return sanear(out);
}

// Consultas permitidas. Cada una proyecta explícitamente lo que publica: no se vuelca la respuesta entera.
// Cada consulta declara `campos`: la lista EXHAUSTIVA de lo que puede publicar. `proyecta` solo elige de dónde
// sale cada cosa; quien decide qué se publica es la lista.
const CONSULTAS = {
  indicadores: {
    descripcion: 'Indicadores del reporte, con su catálogo, estado, valor y denominador',
    ruta: (org) => `/api/v1/organizations/${org}/reports/indicators`,
    campos: ['code', 'catalog', 'status', 'value', 'numerator', 'denominator'],
    proyecta: (b) => b.indicators,
  },
  riesgo: {
    descripcion: 'Lotes con su resultado técnico y vigencia (sin severidad ni datos del productor)',
    ruta: (org) => `/api/v1/organizations/${org}/risk/lots`,
    campos: ['lot_code', 'technical_label', 'freshness'],
    proyecta: (b) => b,
  },
  'catalogo-riesgo': {
    descripcion: 'Catálogo de reglas que aplica a la organización y su estado de adopción',
    ruta: (org) => `/api/v1/organizations/${org}/risk/rule-sets/adoptions`,
    campos: ['version', 'publicacion_global', 'adoptado', 'decisiones'],
    proyecta: (b) => ({ version: b.current_rule_set?.version, publicacion_global: b.current_rule_set?.global_publication, adoptado: b.adopted, decisiones: b.history?.length }),
  },
  satelite: {
    descripcion: 'Estado del proveedor satelital y si las llamadas reales están habilitadas',
    ruta: (org) => `/api/v1/organizations/${org}/satellite/providers`,
    campos: ['seleccion', 'proveedor', 'live_calls_enabled'],
    proyecta: (b) => ({ seleccion: b.selection?.status ?? null, proveedor: b.selection?.provider_code ?? null, live_calls_enabled: b.live_calls_enabled }),
  },
  organizaciones: {
    descripcion: 'Organizaciones visibles para la cuenta',
    ruta: () => '/api/v1/organizations',
    campos: ['name', 'organization_type'],
    proyecta: (b) => b.items ?? b,
  },
};

/**
 * Un error solo puede decir **qué ruta** y **qué código**. Nunca el cuerpo de la respuesta, ni las cabeceras, ni
 * la configuración: un 500 puede traer una traza con una consulta y sus parámetros, y un 401 puede repetir lo
 * enviado. `ruta` es una plantilla construida aquí, no entrada del usuario.
 */
class ErrorDeConsulta extends Error {
  constructor(ruta, status) {
    super(`${ruta} devolvió ${status}`);
    this.name = 'ErrorDeConsulta';
    this.status = status;
  }
}

async function pedir(base, ruta, token) {
  const r = await fetch(`${base}${ruta}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ErrorDeConsulta(ruta, r.status);
  return r.json();
}

/** Autentica y ejecuta la consulta. El token no sale de esta función. */
export async function consultar({ cuenta, consulta, organizacion, base = 'http://localhost:4000', dir = root }) {
  const def = CONSULTAS[consulta];
  if (!def) throw new Error(`Consulta desconocida: ${consulta}. Permitidas: ${Object.keys(CONSULTAS).join(', ')}`);
  const fila = cuentaDemo(cuenta, dir);
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: fila.email, password: fila.contrasena }),
  });
  if (!login.ok) throw new ErrorDeConsulta('/api/v1/auth/login', login.status); // sin cuerpo: un 401 puede repetir lo enviado
  const token = (await login.json()).access_token;

  let orgId = null;
  if (def.ruta.length > 0) {
    const orgs = await pedir(base, '/api/v1/organizations', token);
    const lista = orgs.items ?? orgs;
    const buscada = organizacion ?? fila.organizacion;
    const org = lista.find((o) => o.name === buscada) ?? lista.find((o) => o.name.includes(buscada));
    if (!org) throw new Error(`La cuenta no ve ninguna organización que coincida con «${buscada}».`);
    orgId = org.id;
  }
  const cuerpo = await pedir(base, def.ruta(orgId), token);
  return {
    cuenta: fila.email.split('@')[0],
    organizacion: organizacion ?? fila.organizacion,
    rol: fila.rol,
    consulta,
    resultado: permitir(def.proyecta(cuerpo), def.campos),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--listar-consultas') || !args.length) {
    for (const [k, v] of Object.entries(CONSULTAS)) console.log(`${k.padEnd(16)} ${v.descripcion}`);
    console.log('\nUso: node e2e/review/consulta-api.mjs <cuenta> <consulta> [organización] [--base URL]');
    return;
  }
  const iBase = args.indexOf('--base');
  const base = iBase >= 0 ? args[iBase + 1] : 'http://localhost:4000';
  const libres = args.filter((a, i) => a !== '--base' && (iBase < 0 || i !== iBase + 1));
  const [cuenta, consulta, organizacion] = libres;
  const salida = await consultar({ cuenta, consulta, organizacion, base });
  console.log(JSON.stringify(salida, null, 2));
}

if (process.argv[1] && process.argv[1].endsWith('consulta-api.mjs')) {
  // Solo el mensaje, nunca la traza: una traza puede llevar valores de variables locales (la contraseña leída).
  main().catch((e) => { console.error(e instanceof Error ? e.message : 'Error desconocido'); process.exitCode = 1; });
}
