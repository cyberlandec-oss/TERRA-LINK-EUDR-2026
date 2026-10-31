// Proxy del recorrido en emulador: 127.0.0.1:4001 → API 127.0.0.1:4000 (el emulador usa `adb reverse tcp:4000 tcp:4001`).
// Control en 127.0.0.1:4002: /modo?valor=pass | offline | cortar-tras-commit
// - cortar-subida: igual que la anterior pero para la SUBIDA de un archivo (POST /sync/attachments/:op/content): el servidor la recibe y el cliente no ve la respuesta.
// - offline: cierra cada conexión al instante (equivale a no tener red).
// - cortar-tras-commit: reenvía el SIGUIENTE POST /sync/push, espera la respuesta del servidor (el efecto ya se confirmó)
//   y cierra la conexión del cliente SIN responder; después vuelve a «pass».
// Registro por petición (método, ruta sin query, estado, acción) en el archivo indicado como argumento.
import { appendFileSync } from 'node:fs';
import { createServer, request } from 'node:http';

const log = process.argv[2];
let mode = 'pass';
const note = (o) => appendFileSync(log, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);

createServer((req, res) => {
  const path = (req.url ?? '').split('?')[0];
  if (mode === 'offline') { note({ method: req.method, path, action: 'offline' }); req.socket.destroy(); return; }
  const cut = (mode === 'cortar-tras-commit' && req.method === 'POST' && path.endsWith('/sync/push')) || (mode === 'cortar-subida' && req.method === 'POST' && /\/sync\/attachments\/[^/]+\/content$/.test(path));
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const up = request({ host: '127.0.0.1', port: 4000, path: req.url, method: req.method, headers: req.headers }, (r) => {
      const body = [];
      r.on('data', (c) => body.push(c));
      r.on('end', () => {
        if (cut) { mode = 'pass'; note({ method: req.method, path, status: r.statusCode, action: 'cortado-tras-commit (respuesta del servidor descartada)' }); req.socket.destroy(); return; }
        note({ method: req.method, path, status: r.statusCode, action: 'pass' });
        res.writeHead(r.statusCode ?? 502, r.headers); res.end(Buffer.concat(body));
      });
    });
    up.on('error', () => { note({ method: req.method, path, action: 'error-upstream' }); res.writeHead(502); res.end(); });
    up.end(Buffer.concat(chunks));
  });
}).listen(4001, '127.0.0.1');

createServer((req, res) => {
  const m = /valor=([a-z-]+)/.exec(req.url ?? '');
  if (m) { mode = m[1]; note({ control: mode }); }
  res.end(mode);
}).listen(4002, '127.0.0.1');
console.log('proxy listo');
