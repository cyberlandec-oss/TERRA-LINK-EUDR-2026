// A-01 — MapLibre ejecuta el dibujo en un worker. Se sirve DESDE ESTA MISMA WEB (public/maplibre/), nunca desde un CDN: el archivo se copia
// del paquete instalado (maplibre-gl, BSD-3-Clause) antes de compilar. public/maplibre/ es derivado y está ignorado por git.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const destino = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(destino, { recursive: true });
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) copyFileSync(join(dist, f), join(destino, f));
console.log(`maplibre: worker copiado a ${destino}`);
