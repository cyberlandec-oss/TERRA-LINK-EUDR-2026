#!/usr/bin/env node
// Arnés de carga para las operaciones PROPIAS de Terra Link (RNF-05 / TECH-001). Sin dependencias.
//
//   node scripts/carga-piloto.mjs --config <archivo.json> [--salida <carpeta>] [--validar]
//
// Qué es: una HERRAMIENTA de medición. No es una medición de la plataforma ni una aceptación. Dataset, concurrencia, duración, calentamiento,
// timeout, entorno y objetivos son ENTRADAS EXPLÍCITAS (no hay valores por defecto ni «aprobados»); falta una y no corre (`scripts/carga-piloto.plantilla.json`).
// Reglas de medición:
//  - Una respuesta es SATISFACTORIA solo si su estado HTTP está en `esperado` y llega antes del timeout. Un 500 devuelto en 1 ms NO es satisfactorio:
//    cuenta como error. Los timeouts y errores de red también.
//  - Se informan dos p95: sobre las respuestas satisfactorias, y el p95 «penalizado», donde cada fallo cuenta con el timeout completo. Un objetivo se
//    compara con el penalizado, para que responder rápido con un error no mejore el resultado.
//  - Sin objetivos configurados el arnés INFORMA resultados y no emite veredicto. Con objetivos, compara contra los objetivos de ENTRADA; nunca dice
//    «aprobado»: la aceptación es del responsable (docs/17).
// Seguridad: rechaza el DEMO local (puertos 3000 y 4000) y cualquier destino no local sin confirmación explícita; solo GET salvo mutación declarada
// operación por operación; el token se lee de una variable de entorno y no se imprime, no se guarda y no aparece en el resultado.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const VERSION_ARNES = '1.1.0';
export const PUERTOS_DEMO_BLOQUEADOS = ['3000', '4000'];
const LOCALES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const esEntero = (x, min = 1) => Number.isInteger(x) && x >= min;
const esTexto = (x) => typeof x === 'string' && x.trim().length > 0;
const esFinito = (x) => typeof x === 'number' && Number.isFinite(x); // rechaza Infinity y NaN (incluido 1e999 leído de un JSON)

/** Valida la configuración. Devuelve la lista de errores (vacía si es utilizable). No toca la red y no lee valores secretos. */
export function validarConfig(cfg, env = process.env) {
  const e = [];
  if (!cfg || typeof cfg !== 'object') return ['la configuración no es un objeto JSON'];
  if (!esTexto(cfg.entorno?.etiqueta)) e.push('entorno.etiqueta: indica dónde se mide (obligatorio)');
  if (!esTexto(cfg.entorno?.descripcion)) e.push('entorno.descripcion: describe hardware, almacenamiento y red del destino (obligatorio)');
  if (typeof cfg.entorno?.representativo_del_piloto !== 'boolean') e.push('entorno.representativo_del_piloto: true o false, declarado a conciencia (obligatorio)');
  if (!esTexto(cfg.dataset?.descripcion)) e.push('dataset.descripcion: qué datos tiene el destino (obligatorio; las cifras se declaran, el arnés no las comprueba)');
  for (const k of ['productores', 'parcelas', 'lotes']) if (!esEntero(cfg.dataset?.[k], 0)) e.push(`dataset.${k}: entero ≥ 0 declarado (obligatorio)`);
  const c = cfg.carga ?? {};
  if (!esEntero(c.concurrencia)) e.push('carga.concurrencia: entero ≥ 1 (obligatorio, sin valor por defecto)');
  if (!(esFinito(c.duracion_s) && c.duracion_s > 0)) e.push('carga.duracion_s: número finito > 0 (obligatorio; una duración infinita o NaN no termina o no mide)');
  if (!(esFinito(c.calentamiento_s) && c.calentamiento_s >= 0)) e.push('carga.calentamiento_s: número finito ≥ 0 (obligatorio; 0 si no hay)');
  if (!esEntero(c.timeout_ms)) e.push('carga.timeout_ms: entero ≥ 1 (obligatorio)');
  if (c.semilla !== undefined && !esEntero(c.semilla, 0)) e.push('carga.semilla: entero ≥ 0 si se indica (elige las operaciones de forma reproducible)');

  // Destino
  let url = null;
  try { url = new URL(cfg.destino?.base_url); } catch { e.push('destino.base_url: URL válida (obligatoria)'); }
  if (url) {
    if (!['http:', 'https:'].includes(url.protocol)) e.push('destino.base_url: solo http o https');
    // La base se concatena con las rutas y se repite en el resultado: no puede llevar credenciales, query ni fragmento.
    const cruda = String(cfg.destino.base_url);
    if (url.username || url.password) e.push('destino.base_url: no admite usuario ni contraseña (las credenciales viajan por la variable de entorno del token y no se escriben en la URL)');
    if (url.search || cruda.includes('?')) e.push('destino.base_url: no admite query (?…); se concatenaría con las rutas');
    if (url.hash || cruda.includes('#')) e.push('destino.base_url: no admite fragmento (#…); se concatenaría con las rutas');
    const puerto = url.port || (url.protocol === 'https:' ? '443' : '80');
    const local = LOCALES.has(url.hostname);
    if (local && PUERTOS_DEMO_BLOQUEADOS.includes(puerto)) e.push(`destino: el puerto ${puerto} es el DEMO local; no se ejecuta carga sobre él`);
    if (!local) {
      if (cfg.destino?.permitir_no_local !== true) e.push('destino: el host no es local; exige destino.permitir_no_local = true');
      else if (env.TL_CARGA_CONFIRMA_DESTINO !== url.hostname) e.push('destino: exige además la variable de entorno TL_CARGA_CONFIRMA_DESTINO con el nombre exacto del host');
    }
  }

  // Autenticación (solo se comprueba que la variable exista; el valor no se lee aquí)
  const a = cfg.autenticacion;
  if (!a || !['ninguna', 'bearer_env'].includes(a.tipo)) e.push('autenticacion.tipo: "ninguna" o "bearer_env" (obligatorio)');
  else if (a.tipo === 'bearer_env') {
    if (!esTexto(a.variable)) e.push('autenticacion.variable: nombre de la variable de entorno con el token');
    else if (!env[a.variable]) e.push(`autenticacion: la variable de entorno ${a.variable} no está definida`);
  }

  // Operaciones
  const ops = cfg.operaciones;
  const nombres = new Set();
  if (!Array.isArray(ops) || ops.length === 0) e.push('operaciones: al menos una');
  else {
    for (const [i, op] of ops.entries()) {
      const t = `operaciones[${i}]`;
      if (!esTexto(op?.nombre)) { e.push(`${t}.nombre: obligatorio`); continue; }
      if (nombres.has(op.nombre)) e.push(`${t}: nombre repetido «${op.nombre}»`);
      nombres.add(op.nombre);
      if (!esTexto(op.clase)) e.push(`${t}.clase: obligatoria`);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(op.metodo)) e.push(`${t}.metodo inválido`);
      if (op.metodo !== 'GET' && !(op.mutante === true && cfg.permitir_mutaciones === true)) e.push(`${t}: ${op.metodo} escribe en el destino; exige operaciones[].mutante = true y permitir_mutaciones = true`);
      if (!esTexto(op.ruta) || !op.ruta.startsWith('/')) e.push(`${t}.ruta: debe empezar por /`);
      if (!Array.isArray(op.esperado) || op.esperado.length === 0 || !op.esperado.every((s) => esEntero(s, 100))) e.push(`${t}.esperado: lista de estados HTTP que cuentan como satisfactorios`);
      if (!(esFinito(op.peso) && op.peso > 0)) e.push(`${t}.peso: número finito > 0`);
      for (const m of String(op.ruta ?? '').matchAll(/\{(\w+)\}/g)) {
        const v = op.variables?.[m[1]] ?? cfg.variables?.[m[1]];
        if (!esTexto(v)) e.push(`${t}.ruta: falta la variable {${m[1]}} (en la operación o en «variables»)`);
      }
    }
  }

  // Objetivos (opcionales; si se dan, completos)
  for (const [nombre, o] of Object.entries(cfg.objetivos ?? {})) {
    if (!nombres.has(nombre)) { e.push(`objetivos.${nombre}: no corresponde a ninguna operación`); continue; }
    if (!(esFinito(o?.p95_ms) && o.p95_ms > 0)) e.push(`objetivos.${nombre}.p95_ms: número finito > 0`);
    if (!(esFinito(o?.max_tasa_error) && o.max_tasa_error >= 0 && o.max_tasa_error <= 1)) e.push(`objetivos.${nombre}.max_tasa_error: número finito entre 0 y 1`);
    if (!esEntero(o?.min_muestras)) e.push(`objetivos.${nombre}.min_muestras: entero ≥ 1`);
  }
  return e;
}

/** Percentil por rango más cercano sobre una lista YA ordenada. */
export function percentil(ordenada, p) {
  if (ordenada.length === 0) return null;
  const k = Math.min(ordenada.length, Math.max(1, Math.ceil((p / 100) * ordenada.length)));
  return ordenada[k - 1];
}
// Redondeo SOLO para presentar. Las comparaciones con objetivos usan los valores exactos (ver `exactosPorOperacion` en `ejecutar`).
const redondeo = (x) => (x === null ? null : Math.round(x * 100) / 100);
const redondeo6 = (x) => (x === null ? null : Math.round(x * 1e6) / 1e6);
function resumenLatencias(valores) {
  const s = [...valores].sort((x, y) => x - y);
  if (s.length === 0) return { n: 0, min: null, p50: null, p90: null, p95: null, p99: null, max: null, media: null };
  return { n: s.length, min: redondeo(s[0]), p50: redondeo(percentil(s, 50)), p90: redondeo(percentil(s, 90)), p95: redondeo(percentil(s, 95)), p99: redondeo(percentil(s, 99)), max: redondeo(s[s.length - 1]), media: redondeo(s.reduce((a, b) => a + b, 0) / s.length) };
}

function prng(semilla) { // mulberry32
  let a = semilla >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function construirRuta(op, cfg) {
  return op.ruta.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(op.variables?.[k] ?? cfg.variables?.[k]));
}

const clasificar = (err) => (err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'red');

/** Ejecuta la carga. Devuelve el resultado; no escribe nada y no imprime el token. */
export async function ejecutar(cfg, { env = process.env, fetchImpl = fetch, reloj = () => performance.now() } = {}) {
  const errores = validarConfig(cfg, env);
  if (errores.length) throw new Error(`Configuración no utilizable:\n- ${errores.join('\n- ')}`);
  const { concurrencia, duracion_s: dur, calentamiento_s: cal, timeout_ms: timeoutMs } = cfg.carga;
  const base = cfg.destino.base_url.replace(/\/$/, '');
  const token = cfg.autenticacion.tipo === 'bearer_env' ? env[cfg.autenticacion.variable] : null;
  const ops = cfg.operaciones;
  const pesoTotal = ops.reduce((a, o) => a + o.peso, 0);
  const rnd = prng(cfg.carga.semilla ?? 1);
  const elegir = () => { let x = rnd() * pesoTotal; for (const o of ops) { x -= o.peso; if (x < 0) return o; } return ops[ops.length - 1]; };

  const t0 = reloj();
  const finCalentamiento = t0 + cal * 1000;
  const fin = finCalentamiento + dur * 1000;
  const muestras = []; // { op, ok, ms, causa }

  const trabajador = async () => {
    while (reloj() < fin) {
      const op = elegir();
      const medida = reloj() >= finCalentamiento; // el calentamiento se envía pero no se cuenta
      const headers = { accept: 'application/json', ...(op.cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
      const ini = reloj();
      let ok = false; let causa = null;
      try {
        const r = await fetchImpl(base + construirRuta(op, cfg), { method: op.metodo, headers, body: op.cuerpo !== undefined ? JSON.stringify(op.cuerpo) : undefined, signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
        await r.arrayBuffer(); // la latencia incluye leer el cuerpo completo
        if (op.esperado.includes(r.status)) ok = true; else causa = `http_${r.status}`;
      } catch (err) { causa = clasificar(err); }
      const ms = reloj() - ini;
      if (medida) muestras.push({ op: op.nombre, ok, ms, causa });
    }
  };
  await Promise.all(Array.from({ length: concurrencia }, trabajador));
  const duracionMedidaS = (reloj() - finCalentamiento) / 1000;

  const exactosPorOperacion = new Map();
  const resumir = (lista, nombre, clase) => {
    const oks = lista.filter((m) => m.ok);
    const fallos = lista.filter((m) => !m.ok);
    const causas = {};
    for (const f of fallos) causas[f.causa] = (causas[f.causa] ?? 0) + 1;
    const penalizadas = lista.map((m) => (m.ok ? m.ms : timeoutMs));
    // Valores EXACTOS (sin redondear): son los que se comparan con los objetivos. El redondeo es solo de presentación.
    const exactos = { tasa_error: lista.length ? fallos.length / lista.length : null, p95_penalizado_ms: percentil([...penalizadas].sort((x, y) => x - y), 95) };
    exactosPorOperacion.set(nombre, exactos);
    return {
      operacion: nombre, clase, total: lista.length, satisfactorias: oks.length, fallos: fallos.length, causas_de_fallo: causas,
      tasa_error: exactos.tasa_error === null ? null : redondeo6(exactos.tasa_error),
      latencia_ms_satisfactorias: resumenLatencias(oks.map((m) => m.ms)),
      latencia_ms_de_los_fallos: resumenLatencias(fallos.map((m) => m.ms)),
      p95_ms_penalizado: redondeo(exactos.p95_penalizado_ms),
      satisfactorias_por_s: duracionMedidaS > 0 ? redondeo(oks.length / duracionMedidaS) : null,
    };
  };
  const porOperacion = ops.map((o) => resumir(muestras.filter((m) => m.op === o.nombre), o.nombre, o.clase));
  const global = resumir(muestras, '(todas)', '(todas)');

  const hayObjetivos = Object.keys(cfg.objetivos ?? {}).length > 0;
  const comparacion = porOperacion.map((r) => {
    const o = cfg.objetivos?.[r.operacion];
    if (!o) return { operacion: r.operacion, estado: 'SIN_OBJETIVO' };
    const motivos = [];
    if (r.total < o.min_muestras) return { operacion: r.operacion, estado: 'MUESTRAS_INSUFICIENTES', muestras: r.total, minimo: o.min_muestras, objetivo: o };
    const ex = exactosPorOperacion.get(r.operacion); // sin redondear: una diferencia mínima por encima del objetivo sigue siendo incumplimiento
    if (ex.tasa_error > o.max_tasa_error) motivos.push(`tasa de error ${ex.tasa_error} > ${o.max_tasa_error}`);
    if (ex.p95_penalizado_ms > o.p95_ms) motivos.push(`p95 penalizado ${ex.p95_penalizado_ms} ms > ${o.p95_ms} ms`);
    return { operacion: r.operacion, estado: motivos.length ? 'NO_CUMPLE_OBJETIVO_DE_ENTRADA' : 'CUMPLE_OBJETIVO_DE_ENTRADA', motivos, valores_comparados: { tasa_error: ex.tasa_error, p95_penalizado_ms: ex.p95_penalizado_ms }, objetivo: o };
  });

  return {
    arnes: { nombre: 'carga-piloto', version: VERSION_ARNES },
    ejecutado_en: new Date().toISOString(),
    veredicto: hayObjetivos
      ? 'COMPARACION_CON_OBJETIVOS_DE_ENTRADA: los objetivos son los que se pasaron como entrada. Esto NO es una aceptación; la aceptación es del responsable.'
      : 'SIN_OBJETIVOS_CONFIGURADOS: informe de resultados, sin veredicto.',
    aviso_entorno: cfg.entorno.representativo_del_piloto
      ? 'El entorno se declaró representativo del piloto; esa declaración es de quien ejecuta, el arnés no la comprueba.'
      : 'ENTORNO DECLARADO NO REPRESENTATIVO DEL PILOTO: estos números no sirven para RNF-05.',
    entradas: { entorno: cfg.entorno, dataset: cfg.dataset, destino: { base_url: cfg.destino.base_url }, carga: cfg.carga, autenticacion: { tipo: cfg.autenticacion.tipo }, operaciones: ops.map(({ nombre, clase, metodo, ruta, esperado, peso }) => ({ nombre, clase, metodo, ruta, esperado, peso })), objetivos: cfg.objetivos ?? {} },
    maquina_que_ejecuta: { node: process.version, so: `${os.type()} ${os.release()}`, cpus: os.cpus().length, memoria_gb: Math.round(os.totalmem() / 1e9) },
    duracion_medida_s: redondeo(duracionMedidaS),
    global, por_operacion: porOperacion, comparacion_con_objetivos: comparacion,
    ...(cfg.guardar_muestras === true ? { muestras: muestras.map((m) => ({ ...m, ms: redondeo(m.ms) })) } : {}),
  };
}

export function resumenMarkdown(r) {
  const l = [];
  l.push(`# Resultado de carga (arnés ${r.arnes.version})`, '', `**${r.veredicto}**`, '', `> ${r.aviso_entorno}`, '',
    `Entorno: ${r.entradas.entorno.etiqueta} · dataset declarado: ${r.entradas.dataset.productores} productores, ${r.entradas.dataset.parcelas} parcelas, ${r.entradas.dataset.lotes} lotes · concurrencia ${r.entradas.carga.concurrencia} · ${r.duracion_medida_s} s medidos (calentamiento ${r.entradas.carga.calentamiento_s} s) · timeout ${r.entradas.carga.timeout_ms} ms.`, '',
    '| Operación | Total | Satisfactorias | Fallos | Tasa de error | p50 ms | p95 ms (satisf.) | p95 ms (penalizado) | p99 ms | Satisf./s |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const o of [...r.por_operacion, r.global]) l.push(`| ${o.operacion} | ${o.total} | ${o.satisfactorias} | ${o.fallos} | ${o.tasa_error ?? '—'} | ${o.latencia_ms_satisfactorias.p50 ?? '—'} | ${o.latencia_ms_satisfactorias.p95 ?? '—'} | ${o.p95_ms_penalizado ?? '—'} | ${o.latencia_ms_satisfactorias.p99 ?? '—'} | ${o.satisfactorias_por_s ?? '—'} |`);
  l.push('', '**Causas de fallo:** ' + (Object.entries(r.global.causas_de_fallo).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'ninguna'), '', '**Comparación con los objetivos de entrada:**');
  for (const c of r.comparacion_con_objetivos) l.push(`- ${c.operacion}: ${c.estado}${c.motivos?.length ? ` (${c.motivos.join('; ')})` : ''}`);
  l.push('', 'Un fallo no cuenta como respuesta satisfactoria aunque sea rápido; el p95 penalizado cuenta cada fallo con el timeout completo.');
  return `${l.join('\n')}\n`;
}

async function principal() {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const archivo = arg('--config');
  if (!archivo) { console.error('Uso: node scripts/carga-piloto.mjs --config <archivo.json> [--salida <carpeta>] [--validar]'); process.exit(2); }
  const cfg = JSON.parse(readFileSync(archivo, 'utf8'));
  const errores = validarConfig(cfg);
  if (errores.length) { console.error(`Configuración no utilizable (no se envió ninguna petición):\n- ${errores.join('\n- ')}`); process.exit(2); }
  if (process.argv.includes('--validar')) { console.log('Configuración válida. No se envió ninguna petición.'); return; }
  const r = await ejecutar(cfg);
  const salida = arg('--salida') ?? join('validation-results', `carga-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(salida, { recursive: true });
  writeFileSync(join(salida, 'resultado.json'), `${JSON.stringify(r, null, 2)}\n`);
  writeFileSync(join(salida, 'resumen.md'), resumenMarkdown(r));
  console.log(resumenMarkdown(r));
  console.log(`Guardado en ${salida}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => { console.error(e.message); process.exit(1); });
}
