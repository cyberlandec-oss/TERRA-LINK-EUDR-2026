import { lookup as dnsLookup } from 'dns';
import { request as httpsRequest, type RequestOptions } from 'https';
import { isIP } from 'net';

// P0-028 · defensa de llamadas salientes (QA-15: «redirects y URL maliciosa … credencial no sale a destino ajeno»).
// docs/15 §Seguridad de llamadas externas: «Hosts/protocolos permitidos, validación de destinos y redirecciones,
// protección SSRF/DNS según infraestructura real, timeout, tamaño máximo y redacción de credenciales.»
//
// Decisiones y por qué:
// - Se usa `https.request` (núcleo de Node) y NO `fetch`, por dos capacidades que `fetch` no ofrece: (a) `lookup`
//   propio, que valida CADA dirección resuelta en el momento de conectar —no antes—, cerrando la ventana de
//   *DNS rebinding*; y (b) no seguir redirecciones por omisión.
// - Una redirección NO se sigue nunca. Un 3xx es un bloqueo (`REDIRECT_NOT_FOLLOWED`), no un reintento: seguirla
//   sería entregar la credencial a un destino que no está en la lista blanca.
// - La credencial viaja solo en la cabecera del destino ya validado y se redacta de cualquier texto conservado.

export type EgressBlockReason =
  | 'SCHEME_NOT_ALLOWED' | 'HOST_NOT_ALLOWED' | 'CREDENTIALS_IN_URL' | 'IP_LITERAL' | 'PORT_NOT_ALLOWED'
  | 'MALFORMED_URL' | 'DNS_FAILED' | 'PRIVATE_ADDRESS' | 'REDIRECT_NOT_FOLLOWED' | 'RESPONSE_TOO_LARGE';

export type AddressClass =
  | 'PUBLIC' | 'LOOPBACK' | 'PRIVATE' | 'LINK_LOCAL' | 'CGNAT' | 'MULTICAST' | 'UNIQUE_LOCAL' | 'UNSPECIFIED' | 'RESERVED';

export class EgressBlocked extends Error {
  constructor(readonly reason: EgressBlockReason, readonly detail: string) {
    super(`EGRESS_BLOCKED:${reason}`);
    this.name = 'EgressBlocked';
  }
}

/** Clasificación de una dirección IP. Solo `PUBLIC` puede ser destino de una llamada del servidor. */
export function classifyAddress(ip: string): AddressClass {
  const v = isIP(ip);
  if (v === 4) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'RESERVED';
    const [a, b] = o;
    if (a === 0) return 'UNSPECIFIED';
    if (a === 127) return 'LOOPBACK';
    if (a === 10) return 'PRIVATE';
    if (a === 172 && b >= 16 && b <= 31) return 'PRIVATE';
    if (a === 192 && b === 168) return 'PRIVATE';
    if (a === 169 && b === 254) return 'LINK_LOCAL'; // incluye 169.254.169.254 (metadatos de nube)
    if (a === 100 && b >= 64 && b <= 127) return 'CGNAT';
    if (a >= 224 && a <= 239) return 'MULTICAST';
    if (a >= 240) return 'RESERVED';
    if (a === 192 && b === 0) return 'RESERVED';
    if (a === 198 && (b === 18 || b === 19)) return 'RESERVED';
    return 'PUBLIC';
  }
  if (v === 6) {
    const ip6 = ip.toLowerCase().split('%')[0];
    if (ip6 === '::' ) return 'UNSPECIFIED';
    if (ip6 === '::1') return 'LOOPBACK';
    // IPv4 embebida (::ffff:a.b.c.d): se clasifica por la dirección IPv4 real.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip6);
    if (mapped) return classifyAddress(mapped[1]);
    if (/^f[cd]/.test(ip6)) return 'UNIQUE_LOCAL';
    if (/^fe[89ab]/.test(ip6)) return 'LINK_LOCAL';
    if (/^ff/.test(ip6)) return 'MULTICAST';
    return 'PUBLIC';
  }
  return 'RESERVED';
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: EgressBlockReason; detail: string };

/** Entrada de la lista blanca: «host» (implica el puerto 443) u «host:puerto» cuando el proveedor usa otro. */
function parseEntry(entry: string): { host: string; port: string } {
  const e = entry.toLowerCase().trim().replace(/\.$/, '');
  const i = e.lastIndexOf(':');
  if (i > 0 && /^\d{1,5}$/.test(e.slice(i + 1))) return { host: e.slice(0, i), port: e.slice(i + 1) };
  return { host: e, port: '443' };
}

/**
 * Comprobación del destino ANTES de resolver DNS: protocolo, credenciales en la URL, literal IP, y host + puerto en
 * la lista blanca del proveedor registrado. La lista blanca es exacta (sin comodines ni sufijos): «api.ejemplo.com»
 * no autoriza «api.ejemplo.com.atacante.net». El puerto forma parte de la entrada, no es una regla aparte: una
 * entrada sin puerto autoriza solo el 443.
 */
export function checkUrl(raw: string, allowedHosts: readonly string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'MALFORMED_URL', detail: 'La URL no es válida.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'SCHEME_NOT_ALLOWED', detail: `Solo https; recibido ${url.protocol}` };
  if (url.username || url.password) return { ok: false, reason: 'CREDENTIALS_IN_URL', detail: 'La URL lleva credenciales.' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return { ok: false, reason: 'IP_LITERAL', detail: 'Destino por literal IP: no se admite.' };
  const normalized = url.hostname.toLowerCase().replace(/\.$/, '');
  const port = url.port || '443';
  const entries = allowedHosts.map(parseEntry);
  const sameHost = entries.filter((e) => e.host === normalized);
  if (!sameHost.length) return { ok: false, reason: 'HOST_NOT_ALLOWED', detail: `Host fuera de la lista blanca del proveedor: ${normalized}` };
  if (!sameHost.some((e) => e.port === port)) return { ok: false, reason: 'PORT_NOT_ALLOWED', detail: `Puerto no admitido para ese host: ${port}` };
  return { ok: true, url };
}

export type LookupFn = NonNullable<RequestOptions['lookup']>;

/**
 * `lookup` que rechaza cualquier dirección no pública EN EL MOMENTO DE CONECTAR. Esta es la defensa frente a un
 * nombre de la lista blanca que resuelve a una dirección interna (o que cambia entre la comprobación y la conexión).
 */
export function guardedLookup(base: LookupFn = dnsLookup as LookupFn): LookupFn {
  return ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const cb = typeof options === 'function' ? (options as (...args: unknown[]) => void) : callback;
    const opts = (typeof options === 'function' ? {} : options) as Record<string, unknown>;
    (base as (h: string, o: unknown, c: (...a: unknown[]) => void) => void)(hostname, { ...opts, all: true }, (err: unknown, addresses: unknown) => {
      if (err) return cb(new EgressBlocked('DNS_FAILED', 'No se pudo resolver el destino.'));
      const list = (Array.isArray(addresses) ? addresses : []) as Array<{ address: string; family: number }>;
      if (!list.length) return cb(new EgressBlocked('DNS_FAILED', 'El destino no resolvió a ninguna dirección.'));
      for (const a of list) {
        const cls = classifyAddress(a.address);
        if (cls !== 'PUBLIC') return cb(new EgressBlocked('PRIVATE_ADDRESS', `El destino resuelve a una dirección ${cls}.`));
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  }) as LookupFn;
}

/** Sustituye cualquier secreto por «[REDACTADO]». Se aplica a todo texto que se vaya a conservar o registrar. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[REDACTADO]');
  return out;
}

export interface ExternalRequest {
  url: string;
  allowedHosts: readonly string[];
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
  /** Solo para pruebas: resolución inyectada. En producción es `dns.lookup`. */
  lookup?: LookupFn;
  /**
   * Autoridad certificadora a exigir en el TLS de este destino. Si se indica, SUSTITUYE al almacén del sistema para
   * esta llamada (anclaje a una CA concreta); si se omite, se usa el almacén del sistema. **Nunca** desactiva la
   * verificación: no existe ninguna vía para poner `rejectUnauthorized` en falso.
   */
  ca?: string | Buffer;
}

export interface ExternalResponse {
  status: number;
  contentType: string | null;
  body: Buffer;
}

/**
 * Llamada saliente con todas las defensas aplicadas. Lanza `EgressBlocked` cuando el destino, la redirección o el
 * tamaño incumplen; el resto de fallos (conexión, plazo) se propagan al adapter, que los traduce a un desenlace.
 */
export async function requestExternal(req: ExternalRequest): Promise<ExternalResponse> {
  const check = checkUrl(req.url, req.allowedHosts);
  if (!check.ok) throw new EgressBlocked(check.reason, check.detail);
  const url = check.url;
  return await new Promise<ExternalResponse>((resolve, reject) => {
    const r = httpsRequest(
      url,
      { method: req.method ?? 'GET', headers: req.headers, timeout: req.timeoutMs, lookup: req.lookup ?? guardedLookup(), ...(req.ca ? { ca: req.ca } : {}) },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy();
          // No se sigue: la ubicación puede apuntar fuera de la lista blanca y llevarse la credencial.
          return reject(new EgressBlocked('REDIRECT_NOT_FOLLOWED', `El proveedor respondió ${status} con redirección; no se sigue.`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > req.maxBytes) {
            res.destroy();
            return reject(new EgressBlocked('RESPONSE_TOO_LARGE', `La respuesta supera ${req.maxBytes} bytes.`));
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ status, contentType: res.headers['content-type'] ?? null, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    r.on('timeout', () => r.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    r.on('error', reject);
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}
