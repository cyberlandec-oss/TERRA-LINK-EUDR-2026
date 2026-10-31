// Despliegue local con la revisión de código INYECTADA en el artefacto (RNF-13).
//
//   node scripts/desplegar.mjs [--perfil app]
//
// Por qué existe: `/version` tiene que identificar **el código que está corriendo**. Una etiqueta escrita a
// mano en `.env` o en el compose se queda desactualizada en cuanto alguien reconstruye sin tocarla, y entonces
// `/version` miente. Aquí la revisión se calcula con `git rev-parse` **en el momento de construir** y se pasa
// como `ARG APP_COMMIT`, de modo que el artefacto lleva dentro la revisión con la que se construyó.
//
// Si el árbol tiene cambios sin confirmar, la revisión se marca con `+sucio`: lo desplegado **no es**
// exactamente ese commit y decirlo importa más que tener una cadena limpia.
//
// No toca datos, no borra volúmenes y no ejecuta migraciones por su cuenta: solo construye y levanta el perfil.
import { execFileSync, spawnSync } from 'node:child_process';

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const perfil = arg('--perfil', 'app');

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const sha = git(['rev-parse', '--short', 'HEAD']);
const sucio = git(['status', '--porcelain']).split('\n').filter((l) => l.trim() && !l.includes('AGENTS.md')).length > 0;
const revision = sucio ? `${sha}+sucio` : sha;

console.log(`Revisión a inyectar: ${revision}${sucio ? '  (hay cambios sin confirmar: lo desplegado NO es ese commit exacto)' : ''}`);

const r = spawnSync('docker', ['compose', '--profile', perfil, 'up', '-d', '--build', '--wait'], {
  stdio: 'inherit',
  env: { ...process.env, APP_COMMIT: revision },
});

if (r.status !== 0) {
  console.log('\nEl despliegue falló. No se comprueba la correspondencia porque no hay artefacto nuevo.');
  process.exit(r.status ?? 1);
}

// Correspondencia: lo que `/version` declara tiene que ser lo que se acaba de construir. Si no coincide, el
// despliegue sirve otro código y hay que saberlo aquí, no al investigar un incidente.
const puerto = process.env.API_HOST_PORT ?? '4000';
const res = await fetch(`http://localhost:${puerto}/version`);
const body = await res.json();
const coincide = body.commit === revision;

console.log(`\n/version declara: commit=${body.commit ?? 'null'} (${body.commit_source}) · esquema=${body.schema?.applied}`);
console.log(coincide
  ? `OK    la revisión desplegada coincide con la construida (${revision})`
  : `FALLA la revisión desplegada (${body.commit ?? 'null'}) NO coincide con la construida (${revision})`);
process.exitCode = coincide ? 0 : 1;
