// D — Genera src/ui/mapa-embebido.generated.ts: MapLibre GL JS (la misma versión que la web; módulo y worker autocontenidos), su CSS y el estilo local del mapa
// (infra/maps/estilo.json, sin capas de texto), todo EMBEBIDO en la app. Así el mapa no carga nada de Internet: ni código, ni
// tipografías, ni teselas de terceros. El archivo generado no se versiona (se regenera con `npm run map:embed`).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = join(aqui, '..');
const require = createRequire(join(raiz, 'package.json'));
const pkgDir = dirname(require.resolve('maplibre-gl/package.json'));
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
const mjs = readFileSync(join(pkgDir, 'dist', 'maplibre-gl.mjs'), 'utf8');
const worker = readFileSync(join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), 'utf8');
if (/<\/script/i.test(mjs + worker)) throw new Error('el código contiene </script: no se puede incrustar en línea');
// El módulo termina con `export{a as B,...}`: en una página sin importadores se publica como objeto global `__ML`.
const k = mjs.lastIndexOf('export{');
if (k < 0) throw new Error('no se encontró la lista de exportaciones de MapLibre');
const fin = mjs.indexOf('}', k);
const pares = mjs.slice(k + 7, fin).split(',').map((p) => { const m = /^(\S+) as (\S+)$/.exec(p.trim()); return m ? `${m[2]}:${m[1]}` : `${p.trim()}:${p.trim()}`; });
const js = mjs.slice(0, k) + `window.__ML={${pares.join(',')}};` + mjs.slice(fin + 1).replace(/\/\/# sourceMappingURL=.*/g, '');
const css = readFileSync(join(pkgDir, 'dist', 'maplibre-gl.css'), 'utf8');
const estilo = JSON.parse(readFileSync(join(raiz, '..', '..', 'infra', 'maps', 'estilo.json'), 'utf8'));
// Sin tipografías no hay rótulos: se descartan las capas de texto y la dirección de glifos. Las teselas llegan por el protocolo `tl://` de la app.
const capas = estilo.layers.filter((l) => l.type !== 'symbol');
const fuente = { type: 'vector', tiles: ['tl://{z}/{x}/{y}'], minzoom: 6, maxzoom: 14, attribution: '© OpenStreetMap contributors · © OpenMapTiles' };
const base = { version: 8, name: estilo.name, metadata: estilo.metadata, sources: { osm: fuente }, layers: capas };
const out = join(raiz, 'src', 'ui', 'mapa-embebido.generated.ts');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `// GENERADO por scripts/generar-mapa-embebido.mjs — no editar ni versionar.\nexport const MAPLIBRE_VERSION = ${JSON.stringify(version)};\nexport const MAPLIBRE_JS = ${JSON.stringify(js)};
export const MAPLIBRE_WORKER = ${JSON.stringify(worker.replace(/\/\/# sourceMappingURL=.*/g, ''))};\nexport const MAPLIBRE_CSS = ${JSON.stringify(css)};\nexport const ESTILO_BASE_JSON = ${JSON.stringify(JSON.stringify(base))};\n`);
console.log(`mapa embebido: maplibre-gl ${version}, ${Math.round(js.length / 1024)} KB de JS + ${Math.round(worker.length / 1024)} KB de worker, ${capas.length} capas sin texto -> ${out}`);
