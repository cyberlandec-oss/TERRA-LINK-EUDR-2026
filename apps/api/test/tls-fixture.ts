import { spawnSync } from 'child_process';
import type { ServerResponse } from 'http';
import { createServer, type Server } from 'https';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Servidores HTTPS CONTROLADOS para las pruebas de llamadas salientes (P0-028, QA-15 nivel 2 y adaptador Whisp).
// Nada de esto toca un proveedor real: son servidores del propio equipo con un certificado EFÍMERO que se genera en
// la carpeta temporal del sistema y se borra al terminar. **Ninguna clave privada vive en el repositorio.**
//
// Si `openssl` no está disponible, `tlsAvailable` es false y la suite que lo use debe marcarse como NO EJECUTADA,
// no darse por buena en vacío.

export const tlsAvailable = spawnSync('openssl', ['version'], { encoding: 'utf8' }).status === 0;

export interface Recorded { url: string; method: string; headers: Record<string, string | string[] | undefined>; body: string }
export interface Controlled { server: Server; port: number; recibidas: Recorded[] }
export type Responder = (req: Recorded, res: ServerResponse) => void;

export class TlsFixture {
  readonly dir: string;
  readonly ca: string;
  private readonly key: Buffer;
  private readonly cert: Buffer;
  private readonly servers: Controlled[] = [];

  constructor(hosts: readonly string[] = ['destino.prueba.local', 'prohibido.prueba.local', 'localhost']) {
    this.dir = mkdtempSync(join(tmpdir(), 'tl-tls-'));
    // OPENSSL_CONF propio y vacío: el equipo puede tener esa variable apuntando a un archivo inexistente (p. ej. el
    // de un cliente ODBC) y entonces falla el entorno, no la prueba.
    const conf = join(this.dir, 'openssl.cnf');
    writeFileSync(conf, '');
    const san = [...hosts.map((h) => `DNS:${h}`), 'IP:127.0.0.1'].join(',');
    const r = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-keyout', join(this.dir, 'key.pem'), '-out', join(this.dir, 'cert.pem'), '-subj', `/CN=${hosts[0]}`,
      '-addext', `subjectAltName=${san}`], { encoding: 'utf8', env: { ...process.env, OPENSSL_CONF: conf } });
    if (r.status !== 0) throw new Error(`No se pudo generar el certificado de prueba (openssl salió ${r.status})`);
    this.key = readFileSync(join(this.dir, 'key.pem'));
    this.cert = readFileSync(join(this.dir, 'cert.pem'));
    this.ca = this.cert.toString('utf8');
  }

  async listen(responder: Responder): Promise<Controlled> {
    const recibidas: Recorded[] = [];
    const server = createServer({ key: this.key, cert: this.cert }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const entry: Recorded = { url: req.url ?? '', method: req.method ?? 'GET', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
        recibidas.push(entry);
        responder(entry, res);
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const c: Controlled = { server, port: (server.address() as { port: number }).port, recibidas };
    this.servers.push(c);
    return c;
  }

  async close(): Promise<void> {
    for (const c of this.servers) await new Promise<void>((ok) => c.server.close(() => ok()));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** Resolución inyectada a 127.0.0.1: los nombres de prueba no existen en DNS. Solo para pruebas. */
export const loopbackLookup = ((_h: string, o: unknown, cb: (...a: unknown[]) => void) => {
  const fn = typeof o === 'function' ? (o as (...a: unknown[]) => void) : cb;
  const opts = (typeof o === 'function' ? {} : o) as Record<string, unknown>;
  return opts.all ? fn(null, [{ address: '127.0.0.1', family: 4 }]) : fn(null, '127.0.0.1', 4);
}) as never;

export const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
