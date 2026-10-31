// A-01 — Preparación REPRODUCIBLE de la cartografía local (OpenStreetMap, Ecuador).
//
//   node infra/maps/preparar-mapa.mjs [--fecha 261019] [--sin-teselas]
//
// Qué hace, en orden, con herramientas mantenidas y sin enviar ningún dato de Terra Link a terceros (solo DESCARGA datos públicos):
//   1. Descarga el extracto de Ecuador de Geofabrik (ecuador-<AAMMDD>.osm.pbf) y verifica su MD5 publicado.
//   2. Descarga las fuentes tipográficas de OpenMapTiles (Noto Sans) para las etiquetas del mapa.
//   3. Genera las teselas vectoriales con Planetiler 0.10.2 (esquema OpenMapTiles) en un solo archivo PMTiles.
//      Planetiler descarga además datos públicos auxiliares (Natural Earth, polígonos de agua de OSM) para los niveles bajos.
//   4. Copia el estilo local (infra/maps/estilo.json) y escribe metadata.json (fuente, fecha, sumas de verificación, versiones).
// Todo queda en el volumen Docker `terra-link_map-data` (servido por el servicio `maps`). El resultado es DERIVADO y se puede
// regenerar con este mismo comando; no forma parte del respaldo de la base, pero su metadata.json se guarda en cada respaldo.
// ATRIBUCIÓN y licencia: datos © OpenStreetMap contributors (ODbL 1.0); esquema © OpenMapTiles (CC-BY 4.0); Planetiler (Apache-2.0).
// La cartografía es una REFERENCIA VISUAL: no acredita límites de propiedad, precisión GPS, deforestación ni conformidad.
import { spawnSync } from 'node:child_process';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const SIN_TESELAS = process.argv.includes('--sin-teselas');
const BASE = 'https://download.geofabrik.de/south-america';
const FUENTES_TIPO = 'https://github.com/openmaptiles/fonts/releases/download/v2.0/noto-open-sans.zip';
const PLANETILER = '0.10.2';

const dc = (servicio, args, extraEnv = []) => {
  const r = spawnSync('docker', ['compose', '--profile', 'maps-prep', 'run', '--rm', '--no-deps', ...extraEnv, servicio, ...args], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nFALLÓ el paso «${servicio}». No se publicó nada a medias: el estilo y los metadatos se escriben al final.`); process.exit(r.status ?? 1); }
};

let fecha = arg('--fecha');
if (!fecha) {
  const res = await fetch(`${BASE}/ecuador-latest.osm.pbf`, { method: 'HEAD', redirect: 'manual' });
  const m = /ecuador-(\d{6})\.osm\.pbf/.exec(res.headers.get('location') ?? '');
  if (!m) { console.error('No se pudo resolver la fecha del extracto más reciente; indica --fecha AAMMDD.'); process.exit(2); }
  fecha = m[1];
}
const pbf = `ecuador-${fecha}.osm.pbf`;
console.log(`Extracto: ${BASE}/${pbf}  ·  Planetiler ${PLANETILER}`);

// 1-2) fuentes (PBF verificado + tipografías)
dc('map-fuentes', ['sh', '-c', [
  'set -e', 'apk add --no-cache curl unzip >/dev/null', 'mkdir -p /data/fuentes /data/fonts /data/tiles', 'cd /data/fuentes',
  `if [ ! -f ${pbf} ]; then curl -fL --retry 3 -o ${pbf} ${BASE}/${pbf}; fi`,
  `curl -fsS ${BASE}/${pbf}.md5 | cut -d' ' -f1 > ${pbf}.md5.publicado`,
  `echo "$(cat ${pbf}.md5.publicado)  ${pbf}" | md5sum -c -`,
  'if [ ! -f noto-open-sans.zip ]; then curl -fL --retry 3 -o noto-open-sans.zip ' + FUENTES_TIPO + '; fi',
  'unzip -oq noto-open-sans.zip -d /data/fonts',
].join(' && ')]);

// 3) teselas
if (!SIN_TESELAS) {
  dc('map-teselas', [`--osm-path=/data/fuentes/${pbf}`, '--output=/data/tiles/ecuador.pmtiles', '--download', '--download_dir=/data/fuentes', '--force', '--nodemap-type=array'],
    ['-e', 'JAVA_TOOL_OPTIONS=-Xmx4g']);
}

// 4) estilo y metadatos
dc('map-fuentes', ['sh', '-c', [
  'set -e', 'cp /infra/estilo.json /data/estilo.json', 'cd /data',
  'PMT=$(sha256sum tiles/ecuador.pmtiles | cut -d" " -f1)', 'PBF=$(sha256sum fuentes/' + pbf + ' | cut -d" " -f1)',
  'TAM=$(wc -c < tiles/ecuador.pmtiles)',
  `printf '{"fuente":"OpenStreetMap vía Geofabrik","url":"${BASE}/${pbf}","extracto":"${pbf}","fecha_extracto":"20${fecha.slice(0, 2)}-${fecha.slice(2, 4)}-${fecha.slice(4, 6)}","md5_publicado_verificado":"%s","sha256_pbf":"%s","sha256_pmtiles":"%s","bytes_pmtiles":%s,"herramienta":"Planetiler ${PLANETILER} (esquema OpenMapTiles)","fuentes_tipograficas":"openmaptiles/fonts v2.0 (noto-open-sans)","preparado":"%s","cobertura":"Ecuador continental e insular (extracto nacional de Geofabrik)","licencia":"Datos © OpenStreetMap contributors, ODbL 1.0; esquema © OpenMapTiles, CC-BY 4.0","limites":"Referencia visual. El detalle depende de lo mapeado en OpenStreetMap: en zonas rurales puede haber pocas vías, edificios o cobertura de suelo. No acredita límites de propiedad, precisión GPS, deforestación ni conformidad."}' "$(cat fuentes/${pbf}.md5.publicado)" "$PBF" "$PMT" "$TAM" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > metadata.json`,
  'ls -la /data /data/tiles | head -20',
].join(' && ')]);
console.log('\nListo. Levanta el servicio con: docker compose --profile app up -d maps  ·  Comprobación: http://localhost:8090/metadata.json');
