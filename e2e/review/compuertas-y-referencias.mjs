// Revisión del DESPLIEGUE: compuertas de despacho (D-34.A) y resolución de referencias públicas (RF-47).
//
//   node e2e/review/compuertas-y-referencias.mjs [--base http://localhost:4000]
//
// Sustituye a las comprobaciones ad hoc del 2026-10-16, que dieron resultados vacuos. Aquí todo pasa por
// `comprobacion.mjs`: ningún OK sin el estado HTTP esperado, ninguna comprobación sobre un campo ausente,
// estructura exigida antes de mirar contenido y un caso AUTORIZADO de control junto a las denegaciones.
//
// Las credenciales se leen con la utilidad segura; no se imprimen contraseñas, tokens, referencias ni cuerpos.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

// La referencia de prueba se lee de la BASE LOCAL porque **ninguna API expone hoy `public_reference`**: RF-47
// creó los identificadores y su resolución autorizada, pero entregarlos a un cliente es RF-33, que sigue
// abierta. Sin este dato no habría caso AUTORIZADO de control y la revisión no podría aprobar — que es
// justamente lo que exige el procedimiento. La referencia **no se imprime**.
function referenciaLocalDePrueba(org) {
  const require = createRequire(import.meta.url);
  const { Client } = require('pg');
  const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  const c = new Client({ host: 'localhost', port: Number(env.POSTGRES_PORT || 5440), user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB });
  return c.connect()
    .then(() => c.query("SELECT reference, entity_id FROM public_references WHERE entity_type = 'PRODUCER' AND organization_id = $1 LIMIT 1", [org]))
    .then((r) => r.rows[0] ?? null)
    .finally(() => c.end().catch(() => {}));
}

const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : 'http://localhost:4000'; })();
const ORG = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

async function token(local) {
  const c = cuentaDemo(local);
  if (!c) throw new Error(`cuenta DEMO no encontrada: ${local}`);
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.contrasena }),
  });
  if (!r.ok) throw new Error(`login de ${local}: estado ${r.status}`);
  const b = await r.json();
  if (!b.access_token) throw new Error(`login de ${local}: respuesta sin access_token`);
  return b.access_token;
}

const get = (tk, path) => async () => {
  const r = await fetch(`${base}${path}`, { headers: tk ? { authorization: `Bearer ${tk}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const rev = crearRevision('compuertas de despacho y referencias públicas');

const admin = await token('admin.cooperativa');
const expo = await token('exportacion.exportadora');
const otra = await token('admin.importador');

// ---------------------------------------------------------------- catálogo KDE servido (D-34.A)
const cat = await rev.caso('catálogo KDE servido', {
  pedir: get(admin, `/api/v1/organizations/${ORG}/kde-catalog`), estado: 200,
  estructura: ['current_release.version', 'definitions'],
  comprueba: (b) => [b.current_release.version === '1.7.0', `versión=${b.current_release.version}`],
});
if (cat) {
  const defs = cat.body.definitions;
  const porCodigo = Object.fromEntries(defs.map((d) => [d.code, d]));
  // El catálogo se obtuvo con estado 200 y trae `definitions`: ahora sí significa algo que un código no esté.
  await rev.caso('SHIPMENT_ITEM_PACKAGES obligatorio', {
    pedir: get(admin, `/api/v1/organizations/${ORG}/kde-catalog`), estado: 200, estructura: ['definitions'],
    comprueba: () => {
      const d = porCodigo.SHIPMENT_ITEM_PACKAGES;
      if (!d) return [false, 'no está publicado'];
      return [d.requirement === 'REQUIRED', `requirement=${d.requirement}`];
    },
  });
  await rev.caso('SHIPMENT_DISPATCH_AT sin condición indefinida', {
    pedir: get(admin, `/api/v1/organizations/${ORG}/kde-catalog`), estado: 200, estructura: ['definitions'],
    comprueba: () => {
      const d = porCodigo.SHIPMENT_DISPATCH_AT;
      if (!d) return [false, 'no está publicado'];
      const indefinida = d.condition && d.condition.kind === 'undefined_in_contract';
      return [d.requirement === 'REQUIRED' && !indefinida, `requirement=${d.requirement} condición=${d.condition ? d.condition.kind : 'ninguna'}`];
    },
  });
  await rev.caso('SHIPMENT_PACKAGE retirada del catálogo vigente', {
    pedir: get(admin, `/api/v1/organizations/${ORG}/kde-catalog`), estado: 200, estructura: ['definitions'],
    comprueba: () => [!porCodigo.SHIPMENT_PACKAGE, `${defs.length} definiciones vigentes consultadas`],
  });
}

// ---------------------------------------------------------------- resolución de referencias (RF-47)
// La referencia de entrada se obtiene de la propia API, y si no se obtiene, los casos NO se ejecutan.
const prods = await rev.caso('productores legibles para obtener una referencia de prueba', {
  pedir: get(admin, `/api/v1/organizations/${ORG}/producers`), estado: 200,
  comprueba: (b) => { const items = b.items ?? b; return [Array.isArray(items) && items.length > 0, `${Array.isArray(items) ? items.length : 0} productor(es)`]; },
});

if (prods) {
  const local = await referenciaLocalDePrueba(ORG);
  if (!local) {
    console.log('AVISO  no hay ninguna referencia pública de productor en la base local: los casos de');
    console.log('       resolución NO se ejecutan (no se comprueban con un valor indefinido).');
  } else {
    const ref = exigeEntrada('public_reference', local.reference);
    // CONTROL AUTORIZADO: sin este caso, las denegaciones no distinguirían «deniega» de «servicio caído».
    await rev.caso('CONTROL autorizado: el dueño resuelve su referencia', {
      pedir: get(admin, `/api/v1/public-references/${ref}`), estado: 200, estructura: ['entity_type', 'id'],
      comprueba: (b) => [b.entity_type === 'PRODUCER' && b.id === local.entity_id, `tipo=${b.entity_type}`],
    });
    rev.autorizadoDeControl();

    await rev.caso('cuenta de otra organización no resuelve', {
      pedir: get(otra, `/api/v1/public-references/${ref}`), estado: 404, estructura: ['error.code'],
      comprueba: (b) => [b.error.code === 'NOT_FOUND', `code=${b.error.code}`],
    });
    await rev.caso('rol sin producer:read no resuelve', {
      pedir: get(expo, `/api/v1/public-references/${ref}`), estado: 404, estructura: ['error.code'],
      comprueba: (b) => [b.error.code === 'NOT_FOUND', `code=${b.error.code}`],
    });
    await rev.caso('sin autenticación no resuelve', {
      pedir: get(null, `/api/v1/public-references/${ref}`), estado: 401,
    });
  }
}

// Referencia inexistente: comparable con la ajena solo si ambas se pidieron de verdad.
await rev.caso('referencia inexistente no resuelve', {
  pedir: get(admin, `/api/v1/public-references/${'0'.repeat(24)}`), estado: 404, estructura: ['error.code'],
  comprueba: (b) => [b.error.code === 'NOT_FOUND', `code=${b.error.code}`],
});

// ---------------------------------------------------------------- restricciones que no deben moverse
await rev.caso('ningún expediente alcanza READY', {
  pedir: get(admin, `/api/v1/organizations/${ORG}/reports/indicators`), estado: 200,
  comprueba: (b) => {
    const lista = b.indicators ?? b;
    const i = Array.isArray(lista) ? lista.find((x) => x.code === 'due_diligence_ready') : null;
    if (!i) return [false, 'el indicador due_diligence_ready no viene en la respuesta'];
    return [i.value === '0' || i.numerator === 0, `due_diligence_ready=${i.value}`];
  },
});

process.exitCode = rev.resumen();
