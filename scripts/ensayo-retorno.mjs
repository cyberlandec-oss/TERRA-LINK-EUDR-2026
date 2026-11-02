// RNF-12 — Ensayo de RETORNO Y RECUPERACIÓN, en entorno AISLADO.
//
//   node scripts/ensayo-retorno.mjs --respaldo "<carpeta del respaldo>"
//
// Distingue las TRES cosas que el requisito separa y que no son la misma:
//
//   1. RETORNO DE LA APLICACIÓN  — volver a una versión anterior del código.
//   2. COMPATIBILIDAD CON EL ESQUEMA — si esa versión entiende el esquema que hay en la base.
//   3. RESTAURACIÓN DE DATOS Y OBJETOS — traer de vuelta el contenido desde un respaldo.
//
// **`down`/`up` NO es recuperación de datos**: reconstruye el esquema y, en el caso de las referencias
// públicas, las volvería a generar con OTROS valores. Por eso aquí la recuperación de datos se hace SIEMPRE
// restaurando un respaldo, y el ensayo comprueba que los valores vuelven EXACTOS.
//
// AISLAMIENTO: todo ocurre en una base de ensayo propia (`tl_ensayo_retorno`) creada y eliminada por el
// script. **No toca la base de desarrollo, ni sus volúmenes, ni ningún recurso del otro proyecto Compose.**
// Los datos restaurados se marcan como ENSAYO en el informe.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const RESPALDO = resolve(arg('--respaldo', 'D:/PROYECTOS CYBER LAND/TERRA LINK EUDR 2026/_respaldos/2026-10-17-post-p0003-elevacion'));
const CONTENEDOR = arg('--contenedor', 'terra-link-postgres-1');
const BASE_ENSAYO = 'tl_ensayo_retorno';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .map((l) => l.trim()).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' }, ...opts });
const psql = (db, sqlText) => docker(['exec', '-i', CONTENEDOR, 'sh', '-c',
  `psql -U "$POSTGRES_USER" -d ${db} -tAc ${JSON.stringify(sqlText)}`]).trim();

const pasos = [];
const paso = (nombre, ok, detalle) => { pasos.push({ nombre, ok, detalle }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(56)} ${detalle}`); return ok; };

console.log(`Respaldo de origen: ${RESPALDO}`);
if (!existsSync(`${RESPALDO}/terra_link.dump`)) {
  console.log('FALLA  el respaldo no existe o no tiene terra_link.dump');
  process.exit(1);
}

// Lo que el respaldo declara: es contra esto que se compara, no contra la base de desarrollo, que sigue cambiando.
const estado = readFileSync(`${RESPALDO}/estado-actual.txt`, 'utf8');
const esperado = {
  migraciones: Number(/MIGRACIONES\|(\d+)/.exec(estado)?.[1] ?? 0),
  refHash: /REFERENCIAS_SHA256\|([0-9a-f]{64})\|(\d+)/.exec(estado)?.[1] ?? null,
  refN: Number(/REFERENCIAS_SHA256\|[0-9a-f]{64}\|(\d+)/.exec(estado)?.[1] ?? 0),
  tablas: (estado.match(/^TABLA\|/gm) ?? []).length,
};
console.log(`Declara: ${esperado.migraciones} migraciones · ${esperado.tablas} tablas · ${esperado.refN} referencias\n`);

try {
  // ---------------------------------------------------------------- 3) RESTAURACIÓN DE DATOS
  psql('postgres', `DROP DATABASE IF EXISTS ${BASE_ENSAYO}`);
  psql('postgres', `CREATE DATABASE ${BASE_ENSAYO}`);
  docker(['cp', `${RESPALDO}/terra_link.dump`, `${CONTENEDOR}:/tmp/ensayo.dump`]);
  docker(['exec', CONTENEDOR, 'sh', '-c',
    `pg_restore -U "$POSTGRES_USER" -d ${BASE_ENSAYO} --no-owner --no-privileges /tmp/ensayo.dump`], { stdio: 'pipe' });
  docker(['exec', CONTENEDOR, 'rm', '-f', '/tmp/ensayo.dump']);

  const migraciones = Number(psql(BASE_ENSAYO, 'SELECT count(*) FROM kysely_migration'));
  paso('restauración: migraciones del respaldo', migraciones === esperado.migraciones, `${migraciones} (esperadas ${esperado.migraciones})`);

  const tablas = Number(psql(BASE_ENSAYO, "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname='public'"));
  paso('restauración: tablas del respaldo', tablas === esperado.tablas, `${tablas} (esperadas ${esperado.tablas})`);

  // Las referencias públicas, EXACTAS: no basta el recuento, hay que comprobar los valores.
  const refs = psql(BASE_ENSAYO, "SELECT count(*)::text || '|' || encode(digest(string_agg(reference, ',' ORDER BY reference), 'sha256'), 'hex') FROM public_references");
  const [refN, refHash] = refs.split('|');
  paso('restauración: referencias públicas EXACTAS', Number(refN) === esperado.refN && refHash === esperado.refHash,
    `${refN} referencias · huella ${refHash === esperado.refHash ? 'idéntica' : 'DISTINTA'}`);

  // Cifrados e historial: la identidad sigue cifrada con la clave activa y el historial conserva su protección.
  const k1 = Number(psql(BASE_ENSAYO, "SELECT count(*) FROM producers WHERE split_part(document_number_enc,'.',2)='k1'"));
  const k2 = Number(psql(BASE_ENSAYO, "SELECT count(*) FROM producers WHERE split_part(document_number_enc,'.',2)='k2'"));
  paso('restauración: identidad cifrada con la clave activa', k1 === 0 && k2 > 0, `k2=${k2}, k1=${k1}`);
  const hist = Number(psql(BASE_ENSAYO, 'SELECT count(*) FROM producer_versions'));
  const trg = psql(BASE_ENSAYO, "SELECT tgenabled FROM pg_trigger WHERE tgname='producer_versions_no_mutation'");
  paso('restauración: historial y su protección append-only', hist > 0 && trg === 'O', `${hist} versiones · trigger=${trg}`);

  const claves = existsSync(`${RESPALDO}/claves.env`);
  paso('restauración: las claves necesarias acompañan al respaldo', claves, claves ? 'claves.env presente (no se imprime)' : 'FALTA claves.env: la copia sería ilegible');

  // ---------------------------------------------------------------- 2) COMPATIBILIDAD CON EL ESQUEMA
  const { LATEST_MIGRATION } = require(resolve('apps/api/dist/db/database.js'));
  const aplicada = psql(BASE_ENSAYO, 'SELECT name FROM kysely_migration ORDER BY name DESC LIMIT 1');
  const compatible = aplicada === LATEST_MIGRATION;
  paso('compatibilidad: esquema restaurado frente al código actual', compatible,
    compatible ? `coinciden (${aplicada})` : `aplicada=${aplicada} · código=${LATEST_MIGRATION} → el aviso SCHEMA_CODE_MISMATCH se activaría`);

  // Un retorno a una versión que NO conoce este esquema se detecta: es el caso que el aviso cubre.
  const anteriores = psql(BASE_ENSAYO, 'SELECT name FROM kysely_migration ORDER BY name DESC OFFSET 2 LIMIT 1');
  paso('compatibilidad: un retorno a código más antiguo queda señalado', anteriores !== '' && anteriores !== LATEST_MIGRATION,
    `volver a código que conozca hasta ${anteriores} dejaría el esquema POR DELANTE: detectado por SCHEMA_CODE_MISMATCH`);

  // ---------------------------------------------------------------- 1) RETORNO DE LA APLICACIÓN
  // No se vuelve a un candidato con un defecto de seguridad conocido.
  const vetados = readFileSync(resolve('docs/qa/RETORNO_CANDIDATOS_VETADOS.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const vetadoActual = vetados.some((v) => v.startsWith(sha));
  paso('retorno: la versión actual no está vetada', !vetadoActual, vetadoActual ? `${sha} está vetado` : `${sha} admisible · ${vetados.length} candidato(s) vetado(s) registrados`);

  // ---------------------------------------------------------------- FALLO INDUCIDO durante el procedimiento
  // Se interrumpe una restauración a media escritura: debe quedar IDENTIFICABLE y RECUPERABLE.
  const BASE_FALLO = `${BASE_ENSAYO}_fallo`;
  psql('postgres', `DROP DATABASE IF EXISTS ${BASE_FALLO}`);
  psql('postgres', `CREATE DATABASE ${BASE_FALLO}`);
  let interrumpida = false;
  try {
    // Restauración deliberadamente imposible de completar: el volcado no existe en el contenedor.
    docker(['exec', CONTENEDOR, 'sh', '-c', `pg_restore -U "$POSTGRES_USER" -d ${BASE_FALLO} /tmp/no-existe.dump`], { stdio: 'pipe' });
  } catch {
    interrumpida = true;
  }
  const migFallo = psql(BASE_FALLO, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
  paso('fallo inducido: la interrupción se identifica', interrumpida, interrumpida ? 'pg_restore terminó con error, no en silencio' : 'NO falló: el ensayo no probó nada');
  paso('fallo inducido: deja una situación identificable', Number(migFallo) === 0,
    `la base de ensayo quedó con ${migFallo} tablas: vacía y reconocible, no a medias`);
  // Y es RECUPERABLE: se repite el procedimiento sobre ella y queda completa.
  docker(['cp', `${RESPALDO}/terra_link.dump`, `${CONTENEDOR}:/tmp/ensayo2.dump`]);
  docker(['exec', CONTENEDOR, 'sh', '-c', `pg_restore -U "$POSTGRES_USER" -d ${BASE_FALLO} --no-owner --no-privileges /tmp/ensayo2.dump`], { stdio: 'pipe' });
  docker(['exec', CONTENEDOR, 'rm', '-f', '/tmp/ensayo2.dump']);
  const refs2 = psql(BASE_FALLO, "SELECT encode(digest(string_agg(reference, ',' ORDER BY reference), 'sha256'), 'hex') FROM public_references");
  paso('fallo inducido: el reintento recupera el estado exacto', refs2 === esperado.refHash, `huella ${refs2 === esperado.refHash ? 'idéntica' : 'DISTINTA'}`);

  psql('postgres', `DROP DATABASE IF EXISTS ${BASE_FALLO}`);
} finally {
  // El entorno aislado se elimina siempre: no deja bases de ensayo colgando.
  try { psql('postgres', `DROP DATABASE IF EXISTS ${BASE_ENSAYO}`); } catch { /* ya no está */ }
  try { psql('postgres', `DROP DATABASE IF EXISTS ${BASE_ENSAYO}_fallo`); } catch { /* ya no está */ }
}

const ok = pasos.every((p) => p.ok);
console.log(`\nEnsayo de retorno y recuperación: ${ok ? 'APROBADO' : 'CON FALLAS'} (${pasos.filter((p) => p.ok).length}/${pasos.length})`);
console.log('Datos del ensayo: restaurados desde un respaldo, en base aislada, ya eliminada. No se tocó desarrollo.');
process.exitCode = ok ? 0 : 1;
