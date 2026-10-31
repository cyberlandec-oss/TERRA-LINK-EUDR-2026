// D-43 — Ensayo de la recodificación sobre una COPIA AISLADA del estado actual.
//
//   node infra/d43/ensayo-copia-aislada.mjs <carpeta-del-respaldo> <archivo-de-claves-nuevas>
//
// Levanta un PostgreSQL propio, restaura el volcado, ejecuta la recodificación con las claves nuevas y comprueba
// una por una las condiciones que hacen segura la operación. Al terminar destruye el contenedor y su volumen.
//
// **No toca la base de desarrollo, ni sus volúmenes, ni los respaldos.** El volcado se lee; nada se escribe en la
// carpeta del respaldo.
//
// **No imprime ningún valor personal ni ningún hash de uno.** La igualdad del contenido se comprueba EN MEMORIA,
// comparando lo descifrado antes y después; lo que sale por consola son conteos y veredictos.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const respaldo = process.argv[2];
const clavesNuevas = process.argv[3];
if (!respaldo || !clavesNuevas) {
  console.error('Uso: node infra/d43/ensayo-copia-aislada.mjs <carpeta-del-respaldo> <archivo-de-claves-nuevas>');
  process.exit(2);
}
const CONTENEDOR = 'tl-d43-ensayo';
const VOLUMEN = 'tl-d43-ensayo-data';
const BASE = 'terra_link_d43';
const USUARIO = 'ensayo';
const CLAVE_LOCAL = 'ensayo-local-no-secreta';
const PUERTO = 5470;

const leerEnv = (archivo) => Object.fromEntries(readFileSync(archivo, 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
const docker = (...args) => sh('docker', args, { env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
/** `docker logs` escribe la bitácora de postgres por stderr: hay que juntar las dos salidas. */
function bitacora() {
  const r = spawnSync('docker', ['logs', CONTENEDOR], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

const resultados = [];
const check = (nombre, ok, detalle = '') => { resultados.push({ nombre, ok, detalle }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre}${detalle ? `: ${detalle}` : ''}`); };

// ------------------------------------------------------------------ claves
const viejas = leerEnv(join(respaldo, 'claves.env'));   // llavero del respaldo: contiene la clave expuesta
const nuevas = leerEnv(clavesNuevas);                    // k2 y la clave de índice nueva
if (!viejas.PII_KEYS || !nuevas.PII_KEYS_NUEVA || !nuevas.PII_INDEX_KEY_NUEVA) {
  console.error('El archivo de claves nuevas debe definir PII_KEYS_NUEVA (kid:base64) y PII_INDEX_KEY_NUEVA.');
  process.exit(2);
}
const llaveroCombinado = `${viejas.PII_KEYS},${nuevas.PII_KEYS_NUEVA}`;
const kidNuevo = nuevas.PII_KEYS_NUEVA.split(':')[0];
const indiceNuevo = Buffer.from(nuevas.PII_INDEX_KEY_NUEVA, 'base64');

// Descifrado local, solo para comparar en memoria. Mismo formato que apps/api/src/crypto/pii.ts.
const { createDecipheriv } = await import('node:crypto');
const llavero = Object.fromEntries(llaveroCombinado.split(',').map((p) => { const [k, b] = p.split(':'); return [k, Buffer.from(b, 'base64')]; }));
function descifrar(token, aad) {
  const [v, kid, iv, tag, ct] = token.split('.');
  if (v !== 'v1' || !llavero[kid]) throw new Error('token o clave desconocidos');
  const d = createDecipheriv('aes-256-gcm', llavero[kid], Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
const igual = (a, b) => { const x = Buffer.from(a, 'utf8'); const y = Buffer.from(b, 'utf8'); return x.length === y.length && timingSafeEqual(x, y); };
const CAMPOS = ['document_type', 'document_number', 'phone', 'address'];
const aadProd = (org, id, campo) => `producer|${org}|${id}|${campo}`;
const aadVer = (org, id, version, campo) => `producer_version|${org}|${id}|${version}|${campo}`;
const normalizar = (v) => v.toUpperCase().replace(/[\s.\-]/g, '');

// ------------------------------------------------------------------ entorno aislado
function limpiar() {
  try { docker('rm', '-f', CONTENEDOR); } catch { /* no existía */ }
  try { docker('volume', 'rm', '-f', VOLUMEN); } catch { /* no existía */ }
}

let cliente;
try {
  limpiar();
  console.log('Levantando PostgreSQL aislado…');
  docker('run', '-d', '--name', CONTENEDOR, '-e', `POSTGRES_USER=${USUARIO}`, '-e', `POSTGRES_PASSWORD=${CLAVE_LOCAL}`,
    '-e', 'POSTGRES_DB=postgres', '-p', `${PUERTO}:5432`, '-v', `${VOLUMEN}:/var/lib/postgresql/data`, 'postgis/postgis:16-3.4');
  // El entrypoint de postgres levanta un servidor TEMPORAL durante la inicialización, lo apaga y arranca el
  // definitivo. Responder a `psql` NO basta: el temporal también responde, y justo después se apaga. Hay que
  // esperar al marcador de la bitácora que separa las dos fases, y solo entonces comprobar la conexión.
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  let listo = false;
  for (let i = 0; i < 180 && !listo; i++) {
    await dormir(1000);
    const log = bitacora();
    // El servidor TEMPORAL de la inicialización escucha solo en el socket Unix; el DEFINITIVO es el único que
    // abre IPv4. Ese es el marcador que distingue las dos fases sin ambigüedad.
    if (!log.includes('listening on IPv4 address')) continue;
    try { docker('exec', CONTENEDOR, 'psql', '-U', USUARIO, '-d', 'postgres', '-c', 'SELECT 1'); listo = true; } catch { /* un segundo más */ }
  }
  if (!listo) throw new Error('el PostgreSQL aislado no llegó a aceptar conexiones de forma estable');
  docker('exec', CONTENEDOR, 'psql', '-U', USUARIO, '-d', 'postgres', '-c', `CREATE DATABASE ${BASE} OWNER ${USUARIO}`);
  docker('cp', join(respaldo, 'terra_link.dump'), `${CONTENEDOR}:/tmp/copia.dump`);
  docker('exec', CONTENEDOR, 'pg_restore', '-U', USUARIO, '-d', BASE, '--no-owner', '--no-privileges', '/tmp/copia.dump');
  console.log('Copia restaurada.\n');

  const url = `postgres://${USUARIO}:${CLAVE_LOCAL}@localhost:${PUERTO}/${BASE}`;
  cliente = new pg.Client({ connectionString: url });
  await cliente.connect();

  // ---------------------------------------------------------------- estado ANTES (en memoria)
  const migraciones = (await cliente.query('SELECT count(*)::int AS n FROM kysely_migration')).rows[0].n;
  check('la copia es del estado actual (43 migraciones)', migraciones === 43, `${migraciones}`);

  const prodAntes = (await cliente.query(`SELECT id, organization_id, document_type_enc, document_number_enc, phone_enc, address_enc, document_number_bidx FROM producers ORDER BY id`)).rows;
  const versAntes = (await cliente.query(`SELECT id, organization_id, producer_id, version::text AS version, change_type, changed_by, changed_at::text AS changed_at, reason, snapshot FROM producer_versions ORDER BY id`)).rows;
  const claroProd = new Map();
  for (const p of prodAntes) for (const c of CAMPOS) {
    const t = p[`${c}_enc`];
    if (t) claroProd.set(`${p.id}|${c}`, descifrar(t, aadProd(p.organization_id, p.id, c)));
  }
  const claroVers = new Map();
  for (const v of versAntes) for (const c of CAMPOS) {
    const t = v.snapshot?.[`${c}_enc`];
    if (t) claroVers.set(`${v.id}|${c}`, descifrar(t, aadVer(v.organization_id, v.producer_id, v.version, c)));
  }
  const kidsAntes = [...new Set([...prodAntes.flatMap((p) => CAMPOS.map((c) => p[`${c}_enc`]).filter(Boolean)),
    ...versAntes.flatMap((v) => CAMPOS.map((c) => v.snapshot?.[`${c}_enc`]).filter(Boolean))].map((t) => t.split('.')[1]))];
  check('antes: todo el texto cifrado usa la clave anterior', kidsAntes.length === 1 && kidsAntes[0] !== kidNuevo, `claves en uso: ${kidsAntes.join(',')}`);
  console.log(`   (${claroProd.size} campos de productor y ${claroVers.size} de historial descifrados en memoria para comparar)\n`);

  // ---------------------------------------------------------------- recodificar
  const env = { ...process.env, DATABASE_URL: url, PII_KEYS: llaveroCombinado, PII_ACTIVE_KEY_ID: kidNuevo, PII_INDEX_KEY: nuevas.PII_INDEX_KEY_NUEVA };
  const salida = sh('npm', ['run', 'rekey:pii', '-w', 'apps/api', '--', '--aplicar'], { cwd: root, env, shell: true });
  const json = JSON.parse(salida.slice(salida.indexOf('{'), salida.lastIndexOf('}') + 1));
  check('la recodificación termina sin errores', json.errores.length === 0, JSON.stringify(json.errores));
  check('ningún token conserva la clave anterior', json.claves_en_uso_despues.every((x) => x.startsWith(`${kidNuevo}:`)), json.claves_en_uso_despues.join(' '));

  // ---------------------------------------------------------------- 1) contenido idéntico
  const prodDesp = (await cliente.query(`SELECT id, organization_id, document_type_enc, document_number_enc, phone_enc, address_enc, document_number_bidx FROM producers ORDER BY id`)).rows;
  let igualProd = 0; let distintoProd = 0;
  for (const p of prodDesp) for (const c of CAMPOS) {
    const t = p[`${c}_enc`];
    if (!t) continue;
    const antes = claroProd.get(`${p.id}|${c}`);
    if (antes !== undefined && igual(descifrar(t, aadProd(p.organization_id, p.id, c)), antes)) igualProd++; else distintoProd++;
  }
  check('1) contenido descifrado idéntico en productores', distintoProd === 0 && igualProd === claroProd.size, `${igualProd} iguales, ${distintoProd} distintos`);

  // ---------------------------------------------------------------- 2) historial: contenido y metadatos
  const versDesp = (await cliente.query(`SELECT id, organization_id, producer_id, version::text AS version, change_type, changed_by, changed_at::text AS changed_at, reason, snapshot FROM producer_versions ORDER BY id`)).rows;
  let igualVer = 0; let distintoVer = 0;
  for (const v of versDesp) for (const c of CAMPOS) {
    const t = v.snapshot?.[`${c}_enc`];
    if (!t) continue;
    const antes = claroVers.get(`${v.id}|${c}`);
    if (antes !== undefined && igual(descifrar(t, aadVer(v.organization_id, v.producer_id, v.version, c)), antes)) igualVer++; else distintoVer++;
  }
  check('2a) contenido descifrado idéntico en el historial', distintoVer === 0 && igualVer === claroVers.size, `${igualVer} iguales, ${distintoVer} distintos`);

  const meta = (fila) => JSON.stringify([fila.id, fila.organization_id, fila.producer_id, fila.version, fila.change_type, fila.changed_by, fila.changed_at, fila.reason,
    Object.keys(fila.snapshot ?? {}).filter((k) => !CAMPOS.some((c) => k === `${c}_enc`)).sort().map((k) => [k, fila.snapshot[k]])]);
  const metaIgual = versAntes.length === versDesp.length && versAntes.every((v, i) => meta(v) === meta(versDesp[i]));
  check('2b) identidad, autoría, fechas, orden y contenido no cifrado del historial intactos', metaIgual, `${versDesp.length} filas`);

  // ---------------------------------------------------------------- 3) índice recalculado
  let indicesOk = 0; let indicesMal = 0;
  for (const p of prodDesp) {
    if (!p.document_number_bidx) continue;
    const doc = claroProd.get(`${p.id}|document_number`);
    const esperado = createHmac('sha256', indiceNuevo).update(`${p.organization_id}|DOC|${normalizar(doc)}`).digest('hex');
    if (p.document_number_bidx === esperado) indicesOk++; else indicesMal++;
  }
  check('3a) cada índice ciego es el que corresponde a la clave nueva', indicesMal === 0 && indicesOk > 0, `${indicesOk} correctos, ${indicesMal} incorrectos`);
  const cambiados = prodDesp.filter((p, i) => p.document_number_bidx && p.document_number_bidx !== prodAntes[i].document_number_bidx).length;
  check('3b) ningún índice conserva el valor anterior', cambiados === indicesOk, `${cambiados} cambiados de ${indicesOk}`);

  // Búsqueda por documento: la consulta real del producto es igualdad sobre el índice.
  const unoConDoc = prodDesp.find((p) => p.document_number_bidx);
  const docClaro = claroProd.get(`${unoConDoc.id}|document_number`);
  const buscado = createHmac('sha256', indiceNuevo).update(`${unoConDoc.organization_id}|DOC|${normalizar(docClaro)}`).digest('hex');
  const hallados = (await cliente.query('SELECT id FROM producers WHERE organization_id = $1 AND document_number_bidx = $2', [unoConDoc.organization_id, buscado])).rows;
  check('3c) la búsqueda por documento encuentra al productor', hallados.some((h) => h.id === unoConDoc.id), `${hallados.length} coincidencia(s)`);

  // Detección de duplicados: dos productores con el mismo documento en la misma organización comparten índice.
  const porIndice = new Map();
  for (const p of prodDesp) if (p.document_number_bidx) {
    const k = `${p.organization_id}|${p.document_number_bidx}`;
    porIndice.set(k, (porIndice.get(k) ?? 0) + 1);
  }
  const duplicadosDetectables = [...porIndice.values()].filter((n) => n > 1).length;
  check('3d) la detección de duplicados sigue siendo posible (igualdad de índice por organización)', porIndice.size > 0, `${porIndice.size} índice(s) distinto(s), ${duplicadosDetectables} con más de un productor`);

  // ---------------------------------------------------------------- 4) aislamiento entre organizaciones
  const cruces = (await cliente.query(`
    SELECT count(*)::int AS n FROM producers a JOIN producers b
      ON a.document_number_bidx = b.document_number_bidx AND a.organization_id <> b.organization_id
    WHERE a.document_number_bidx IS NOT NULL`)).rows[0].n;
  check('4) ningún índice coincide entre organizaciones distintas', cruces === 0, `${cruces} cruce(s)`);

  const inconsistentes = (await cliente.query(`SELECT count(*)::int AS n FROM producers WHERE (document_number_enc IS NULL) <> (document_number_bidx IS NULL)`)).rows[0].n;
  check('4b) el CHECK de consistencia cifrado↔índice se mantiene', inconsistentes === 0, `${inconsistentes} inconsistente(s)`);

  // ---------------------------------------------------------------- 5) append-only restaurado
  const trg = (await cliente.query(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`)).rows[0];
  check('5a) la protección append-only quedó activa', trg && trg.tgenabled !== 'D', `tgenabled=${trg?.tgenabled}`);
  let mordio = false;
  try { await cliente.query(`UPDATE producer_versions SET reason = 'intento' WHERE id = $1`, [versDesp[0].id]); }
  catch { mordio = true; }
  check('5b) y rechaza una modificación del historial', mordio);

  // ---------------------------------------------------------------- 6) reversión ante un fallo inducido
  const antesFallo = (await cliente.query('SELECT id, document_number_enc, document_number_bidx FROM producers ORDER BY id')).rows;
  const versAntesFallo = (await cliente.query('SELECT id, snapshot FROM producer_versions ORDER BY id')).rows;
  let fallo = false;
  try {
    sh('npm', ['run', 'rekey:pii', '-w', 'apps/api', '--', '--aplicar'], { cwd: root, shell: true, env: { ...env, PII_ACTIVE_KEY_ID: 'kX-inexistente' } });
  } catch { fallo = true; }
  const desFallo = (await cliente.query('SELECT id, document_number_enc, document_number_bidx FROM producers ORDER BY id')).rows;
  const versDesFallo = (await cliente.query('SELECT id, snapshot FROM producer_versions ORDER BY id')).rows;
  const trgFallo = (await cliente.query(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'producer_versions_no_mutation'`)).rows[0];
  check('6a) un fallo inducido aborta la operación', fallo);
  check('6b) y no deja nada a medias: productores e historial idénticos', JSON.stringify(antesFallo) === JSON.stringify(desFallo) && JSON.stringify(versAntesFallo) === JSON.stringify(versDesFallo));
  check('6c) ni el trigger desactivado', trgFallo && trgFallo.tgenabled !== 'D', `tgenabled=${trgFallo?.tgenabled}`);

  // ---------------------------------------------------------------- 7) conteos conservados
  const conteos = (await cliente.query(`SELECT (SELECT count(*) FROM producers) p, (SELECT count(*) FROM producer_versions) v, (SELECT count(*) FROM organizations) o, (SELECT count(*) FROM lots) l`)).rows[0];
  check('7) conteos conservados', Number(conteos.p) === prodAntes.length && Number(conteos.v) === versAntes.length,
    `${conteos.p} productores, ${conteos.v} versiones, ${conteos.o} organizaciones, ${conteos.l} lotes`);
} finally {
  if (cliente) await cliente.end().catch(() => {});
  limpiar();
  console.log('\nEntorno aislado destruido (contenedor y volumen).');
  const ok = resultados.length > 0 && resultados.every((r) => r.ok);
  console.log(`\nResultado del ensayo: ${ok ? 'APROBADO' : 'FALLIDO'} — ${resultados.filter((r) => r.ok).length}/${resultados.length} comprobaciones.`);
  if (!ok) process.exitCode = 1;
}
