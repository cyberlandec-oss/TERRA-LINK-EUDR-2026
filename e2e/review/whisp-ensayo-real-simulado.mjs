// Comprueba el COMPORTAMIENTO de e2e/review/whisp-ensayo-real.mjs frente a respuestas simuladas de un servidor LOCAL (127.0.0.1). No toca Whisp ni usa claves reales.
//   node e2e/review/whisp-ensayo-real-simulado.mjs
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readdirSync, rmSync } from 'node:fs';

const props = { risk_pcrop: 'more_info_needed', whisp_processing_metadata: { whisp_version: 'x', processing_timestamp_utc: '2026-06-11 01:59:15+0000' } };
const FC = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: props }] };
const CFG = { geometryLimitSync: 1 };
const cola = (u, j) => (u === '/api/config' ? j(200, CFG) : u === '/api/submit/geojson' ? j(202, { code: 'analysis_queued', data: { token: 't' } }) : null);
const escenarios = [
  { nombre: 'configuración 503 ⇒ NO se envía y termina con error', esperado: 1, noPost: true, ruta: (u, j) => (u === '/api/config' ? j(503, { code: 'x' }) : j(200, FC)) },
  { nombre: 'analysis_cancelled con HTTP 200 ⇒ termina de inmediato (no sondea 40 veces)', esperado: 1, maxEstados: 1, ruta: (u, j) => cola(u, j) ?? j(200, { code: 'analysis_cancelled' }) },
  { nombre: 'completado sin FeatureCollection ⇒ descarga alternativa y éxito', esperado: 0, ruta: (u, j) => cola(u, j) ?? (u === '/api/status/t' ? j(200, { code: 'analysis_completed' }) : u === '/api/generate-geojson/t' ? j(200, FC) : j(404, {})) },
  { nombre: 'completado con FeatureCollection vacía ⇒ falla por contrato', esperado: 1, ruta: (u, j) => (u === '/api/config' ? j(200, CFG) : u === '/api/submit/geojson' ? j(200, { code: 'analysis_completed', data: { type: 'FeatureCollection', features: [] } }) : j(404, {})) },
  { nombre: 'resultado sincrónico válido ⇒ éxito', esperado: 0, ruta: (u, j) => (u === '/api/config' ? j(200, CFG) : u === '/api/submit/geojson' ? j(200, { code: 'analysis_completed', data: FC }) : j(404, {})) },
];
let fallos = 0;
for (const [i, e] of escenarios.entries()) {
  const vistas = [];
  const srv = http.createServer((q, r) => {
    vistas.push(`${q.method} ${q.url}`);
    const j = (c, b) => { r.writeHead(c, { 'content-type': 'application/json' }); r.end(JSON.stringify(b)); return true; };
    e.ruta(q.url, j);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const puerto = srv.address().port;
  const p = await new Promise((ok) => {
    import('node:child_process').then(({ spawn }) => {
      const hijo = spawn(process.execPath, ['e2e/review/whisp-ensayo-real.mjs'], { env: { ...process.env, WHISP_BASE_URL: `http://127.0.0.1:${puerto}`, WHISP_API_KEY: 'clave-falsa-local', WHISP_ENSAYO_AUTORIZADO: 'SI_TERMINOS_ACEPTADOS_POR_EL_PROPIETARIO', WHISP_POLL_MS: '5', WHISP_MAX_POLLS: '40' } });
      hijo.on('close', (status) => ok({ status }));
    });
  });
  srv.close();
  const estados = vistas.filter((v) => v.startsWith('GET /api/status/')).length;
  const ok = p.status === e.esperado && (!e.noPost || !vistas.some((v) => v.startsWith('POST '))) && (e.maxEstados === undefined || estados <= e.maxEstados);
  if (!ok) fallos++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${i + 1}. ${e.nombre} (salida ${p.status}, esperada ${e.esperado}; consultas de estado ${estados})`);
}
void spawnSync;
for (const d of readdirSync('validation-results').filter((x) => x.startsWith('whisp-ensayo-real-'))) rmSync(`validation-results/${d}`, { recursive: true, force: true });
console.log(`\n${escenarios.length - fallos}/${escenarios.length} escenarios. Sin red externa.`);
process.exit(fallos ? 1 : 0);
