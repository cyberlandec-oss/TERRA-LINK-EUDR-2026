import { inflateSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { join } from 'node:path';

// P1-013 — Lectura del texto de un PDF, **en local y con decodificación real**.
//
// POR QUÉ CAMBIÓ EL MOTOR (2026-10-19)
// La primera versión descomprimía los flujos a mano y recogía los operadores de texto. Eso funciona con PDF
// sencillos, pero **no decodifica**: la mayoría de los PDF reales subconjuntan las fuentes y escriben
// **identificadores de glifo**, que solo se traducen leyendo el mapa de la fuente. Las heurísticas que se
// probaron —proporción de caracteres legibles, caracteres de control, ausencia de espacios— **detectaban los
// ejemplos probados**, pero no demuestran que los caracteres correspondan al documento: un texto mal
// decodificado puede seguir pareciendo texto.
//
// Reconstruir un lector de PDF general a mano sería rehacer, peor, algo que ya existe. Así que **solo esa
// pieza** se sustituye por un componente **mantenido y local**: **pdf.js** (`pdfjs-dist`), el motor de PDF de
// Mozilla, que interpreta codificaciones y mapas de fuente.
//
// LA COMPROBACIÓN DE SOPORTE ES **POR OBJETO**, NO POR PROXIMIDAD (2026-10-19)
// Una primera versión de esta comprobación buscaba `/ToUnicode` en una **ventana de texto** alrededor de cada
// `/Type0`. Eso **no demuestra asociación**: con dos fuentes vecinas —una con mapa y otra sin él— el mapa de
// la primera **validaba indebidamente** a la segunda. Comprobado con un archivo construido a propósito: la
// ventana encontraba **0** fuentes sin mapa cuando había **1**, y la segunda fuente producía «HIJK»,
// perfectamente imprimible y **falso**.
//
// Ahora se **interpretan los objetos del documento y sus referencias**: se enumeran los objetos —incluidos
// los que viven dentro de **flujos de objetos** (`/ObjStm`), que es donde los guardan los PDF modernos— y de
// cada fuente compuesta se mira **su propio diccionario**. Si no declara `/ToUnicode`, **esa** fuente no se
// puede traducir, por mucho que otra de al lado sí.
//
// Y si **no se puede determinar** el soporte —un flujo de objetos que no se descomprime, una cabecera que no
// se entiende—, **no se da por bueno**: se devuelve una **limitación explícita** y no se sugiere nada.
// Tampoco se presenta la mera presencia de `/ToUnicode` como garantía de que el mapa sea correcto: lo que
// acredita es que el documento **declara** el soporte; sin esa declaración, el rechazo es seguro.
//
// LO QUE **NO** CAMBIA
//   · **nada sale de la instalación**: pdf.js es una biblioteca local, no un servicio;
//   · **no hay OCR**: una imagen o un PDF escaneado siguen sin leerse, y se declara;
//   · **los límites se conservan y ahora INTERRUMPEN de verdad**: cada operación —abrir, leer una página,
//     extraer su texto— va contra un plazo, y al vencer se **libera el documento** en vez de esperar;
//   · **la procedencia se conserva**: el motor y su versión viajan con cada extracción.

export const MOTOR = 'pdfjs-dist';
/** Versión del componente, fijada en `package.json`. Viaja con cada extracción como procedencia. */
export const MOTOR_VERSION = '4.10.38';

/** Tope de texto acumulado. Un documento operativo normal cabe de sobra. */
export const MAX_CHARS = 200_000;
/** Tope de páginas leídas. */
export const MAX_PAGES = 200;
/** Plazo de cada operación del lector: abrir, obtener una página, extraer su texto. */
export const MAX_MS_OPERACION = 10_000;
/** Plazo total de la lectura. */
export const MAX_MS_TOTAL = 30_000;
/** Tope de memoria del decodificador. Al superarlo el proceso muere: la bomba no llega al servicio. */
export const MAX_MB_SUBPROCESO = 512;
/** Tope por flujo al auditar la estructura. */
export const MAX_STREAM_BYTES = 4_000_000;
/** Tope de objetos inspeccionados al auditar la estructura. */
export const MAX_OBJETOS = 20_000;

export interface AuditoriaFuentes {
  /** Fuentes compuestas encontradas. */
  composite: number;
  /** Fuentes compuestas que **no declaran** `/ToUnicode` en su propio diccionario. */
  without_map: number;
  /** Partes del documento que no se pudieron inspeccionar: impiden afirmar que todo se comprobó. */
  undetermined: number;
}

export interface TextoPdf {
  text: string;
  pages: number;
  /** `true` si se alcanzó algún límite y el texto quedó incompleto. */
  truncated: boolean;
  /** `true` si el documento trae capa de texto, se pueda mapear o no. */
  hasTextLayer: boolean;
  /** `false` si no se puede garantizar que el texto sea el del documento: no se publica nada. */
  interpretable: boolean;
  reason: 'OK' | 'SIN_CAPA_DE_TEXTO' | 'FUENTE_SIN_MAPA' | 'SOPORTE_INDETERMINADO' | 'NO_SE_PUDO_ABRIR'
    | 'TIEMPO_AGOTADO' | 'LIMITE_EXCEDIDO';
  /** Fragmentos con caracteres sin mapear. */
  unmapped_items: number;
  /** Auditoría estructural de las fuentes. */
  fonts: AuditoriaFuentes;
}

/** Ruta del decodificador. Vive junto a este archivo, tanto en `src` como en `dist`. */
const SUBPROCESO = join(__dirname, 'pdf-subproceso.mjs');

interface RespuestaSubproceso {
  reason: 'OK' | 'NO_SE_PUDO_ABRIR';
  text?: string;
  pages?: number;
  truncated?: boolean;
  hasTextLayer?: boolean;
  unmapped_items?: number;
}

/**
 * Ejecuta la decodificación en **otro proceso** y lo **mata** si se pasa del plazo.
 *
 * Esto es lo que convierte el límite en un límite: un control de tiempo dentro del mismo proceso no
 * interrumpe una apertura ni una página bloqueadas —el plazo vence, pero el trabajo sigue—. Aquí el trabajo
 * **termina** y su memoria, hilos y descriptores los **libera el sistema operativo**. El tope de memoria
 * acota además las bombas de descompresión: el hijo muere, el servicio no.
 */
export function decodificar(
  bytes: Buffer,
  opciones: { ms?: number; script?: string } = {},
): Promise<{ r: RespuestaSubproceso | null; agotado: boolean; excedido: boolean; pid: number | undefined }> {
  const ms = opciones.ms ?? MAX_MS_TOTAL;
  const script = opciones.script ?? SUBPROCESO;
  return new Promise((resolve) => {
    let hecho = false;
    const fin = (v: { r: RespuestaSubproceso | null; agotado: boolean; excedido: boolean }) => {
      if (hecho) return;
      hecho = true;
      clearTimeout(reloj);
      // SIGKILL, no SIGTERM: un hijo atascado en un bucle cerrado no atiende una señal que pueda ignorar.
      try { hijo.kill('SIGKILL'); } catch { /* ya terminado */ }
      resolve({ ...v, pid: hijo.pid });
    };

    const hijo = fork(script, [JSON.stringify({ maxChars: MAX_CHARS, maxPages: MAX_PAGES })], {
      silent: true,
      // Sin heredar los argumentos del proceso padre: el hijo solo necesita su tope de memoria.
      execArgv: [`--max-old-space-size=${MAX_MB_SUBPROCESO}`],
    });
    const reloj = setTimeout(() => fin({ r: null, agotado: true, excedido: false }), ms);

    hijo.on('message', (m) => fin({ r: m as RespuestaSubproceso, agotado: false, excedido: false }));
    hijo.on('error', () => fin({ r: null, agotado: false, excedido: false }));
    // Si termina sin contestar, se quedó sin memoria o lo mató una señal: es un límite, no un PDF ilegible.
    hijo.on('exit', (code, signal) => fin({ r: null, agotado: false, excedido: code !== 0 || signal !== null }));
    hijo.stdin?.on('error', () => fin({ r: null, agotado: false, excedido: false }));
    hijo.stdin?.end(bytes);
  });
}

/**
 * Audita las fuentes **objeto a objeto**: cada fuente compuesta se comprueba en **su propio diccionario**,
 * no por proximidad textual. Enumera también los objetos guardados dentro de flujos `/ObjStm`.
 *
 * Lo que no se puede inspeccionar se cuenta en `undetermined`: **no** se da por comprobado.
 */
export function auditarFuentes(bytes: Buffer): AuditoriaFuentes {
  const crudo = bytes.toString('latin1');
  const cuerpos: string[] = [];
  let indeterminados = 0;

  const superiores: Array<{ body: string }> = [];
  for (const m of crudo.matchAll(/\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj/g)) {
    if (superiores.length >= MAX_OBJETOS) { indeterminados += 1; break; }
    superiores.push({ body: m[1] });
  }
  for (const o of superiores) cuerpos.push(o.body);

  for (const o of superiores) {
    if (!/\/Type\s*\/ObjStm/.test(o.body)) continue;
    const ini = o.body.indexOf('stream');
    const fin = o.body.indexOf('endstream');
    if (ini < 0 || fin < 0) { indeterminados += 1; continue; }
    const datos = Buffer.from(o.body.slice(ini + 'stream'.length, fin).replace(/^\r?\n/, ''), 'latin1');
    if (datos.length === 0 || datos.length > MAX_STREAM_BYTES) { indeterminados += 1; continue; }
    let plano: string;
    // Tope de SALIDA, no de entrada: un flujo pequeño que se expande sin fin se corta aquí.
    try { plano = inflateSync(datos, { maxOutputLength: MAX_STREAM_BYTES }).toString('latin1'); } catch { indeterminados += 1; continue; }
    const n = Number(/\/N\s+(\d+)/.exec(o.body)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(o.body)?.[1] ?? 0);
    if (!n || !first) { indeterminados += 1; continue; }
    const cab = plano.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i += 1) {
      const off = cab[i * 2 + 1];
      const sig = i + 1 < n ? cab[(i + 1) * 2 + 1] : plano.length - first;
      if (!Number.isFinite(off) || !Number.isFinite(sig)) { indeterminados += 1; continue; }
      cuerpos.push(plano.slice(first + off, first + sig));
    }
  }

  let compuestas = 0;
  let sinMapa = 0;
  for (const body of cuerpos) {
    if (!/\/Subtype\s*\/Type0/.test(body)) continue;
    compuestas += 1;
    // El `/ToUnicode` tiene que estar en ESTE diccionario, no cerca de él.
    if (!/\/ToUnicode/.test(body)) sinMapa += 1;
  }
  return { composite: compuestas, without_map: sinMapa, undetermined: indeterminados };
}

/**
 * Lee la capa de texto de un PDF con pdf.js. **Nunca lanza**: un archivo ilegible devuelve texto vacío con su
 * razón, que el módulo publica como límite declarado y no como fallo del sistema.
 */
export async function textoDePdf(bytes: Buffer): Promise<TextoPdf> {
  const fonts = auditarFuentes(bytes);
  const base = { text: '', pages: 0, truncated: false, hasTextLayer: false, unmapped_items: 0, fonts };

  const { r, agotado, excedido } = await decodificar(bytes);
  if (agotado) return { ...base, truncated: true, interpretable: false, reason: 'TIEMPO_AGOTADO' };
  if (!r) return { ...base, truncated: true, interpretable: false, reason: excedido ? 'LIMITE_EXCEDIDO' : 'NO_SE_PUDO_ABRIR' };
  if (r.reason !== 'OK') return { ...base, interpretable: false, reason: 'NO_SE_PUDO_ABRIR' };

  const texto = r.text ?? '';
  const capaDeTexto = r.hasTextLayer === true;
  const sinMapear = r.unmapped_items ?? 0;
  const comun = { pages: r.pages ?? 0, truncated: r.truncated === true, unmapped_items: sinMapear, fonts };

  if (fonts.without_map > 0 || sinMapear > 0) {
    // Alguna fuente no declara su mapa: lo obtenido NO se puede dar por texto del documento.
    return { ...comun, text: '', hasTextLayer: true, interpretable: false, reason: 'FUENTE_SIN_MAPA' };
  }
  if (fonts.undetermined > 0 && capaDeTexto) {
    // No se pudo comprobar todo el documento: no se afirma que las fuentes estén soportadas.
    return { ...comun, text: '', hasTextLayer: true, interpretable: false, reason: 'SOPORTE_INDETERMINADO' };
  }
  if (!capaDeTexto || texto.length === 0) {
    return { ...comun, text: '', hasTextLayer: capaDeTexto, interpretable: !capaDeTexto, reason: 'SIN_CAPA_DE_TEXTO' };
  }
  return { ...comun, text: texto, hasTextLayer: true, interpretable: true, reason: 'OK' };
}
