// Revisión del DESPLIEGUE: observabilidad segura (RNF-10 separación de avisos, RNF-13 métricas y trazas).
//
//   node e2e/review/observabilidad.mjs [--base http://localhost:4000]
//
// Comprueba sobre el servicio desplegado, con inicios de sesión REALES de cuentas DEMO de distinto rol:
//   · que la respuesta ANÓNIMA de avisos no revela identificadores, ni recuentos de recursos protegidos, ni
//     detalle de ninguna organización —y que el dato existe de verdad, vía control autorizado—;
//   · que la actividad operativa se sirve por organización y permiso a permiso;
//   · que las MÉTRICAS suben con peticiones reales y sus etiquetas no llevan identificadores;
//   · que una TRAZA concreta se recorre desde el `request_id` hasta sus tramos de base de datos.
//
// Cada denegación lleva su control autorizado (`comprobacion.mjs`). No imprime contraseñas ni tokens, y no
// modifica ningún dato: todas las peticiones son de lectura.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : 'http://localhost:4000'; })();
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

async function iniciarSesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: estado ${r.status}`);
  const b = await r.json();
  if (!b.access_token) throw new Error(`login de ${local}: sin access_token`);
  return b.access_token;
}

const pedir = (tk, metodo, path, cabeceras = {}) => async () => {
  const r = await fetch(`${base}${path}`, { method: metodo, headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...cabeceras } });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { body = null; }
  return { status: r.status, body, texto };
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const INFRA = ['CORE_DEPENDENCY_DOWN', 'SCHEMA_CODE_MISMATCH', 'DOCUMENT_ANALYSIS_UNAVAILABLE'];
const OPERATIVOS = ['DOCUMENTS_PENDING_ANALYSIS', 'EVENT_DELIVERIES_DEAD'];
const buscar = (b, code) => (b.alerts ?? []).find((a) => a.code === code);

/** Valor de una serie del texto de exposición Prometheus; `null` si no existe. */
function serie(texto, nombre, etiquetas) {
  const sel = Object.entries(etiquetas).map(([k, v]) => `${k}="${v}"`);
  for (const linea of texto.split('\n')) {
    if (!linea.startsWith(`${nombre}{`)) continue;
    if (sel.every((s) => linea.includes(s))) return Number(linea.slice(linea.lastIndexOf('}') + 1).trim());
  }
  return null;
}

const rev = crearRevision('observabilidad: avisos separados, métricas y trazas');

const admin = await iniciarSesion('admin.cooperativa');        // ORG_ADMIN: document:read y events:reprocess
const auditor = await iniciarSesion('auditor.cooperativa');    // AUDITOR: document:read, SIN events:reprocess
const comprador = await iniciarSesion('comprador.importador'); // BUYER de OTRA organización
const plataforma = await iniciarSesion('superadmin.revision'); // SUPER_ADMIN: observability:read
const tecnico = await iniciarSesion('tecnico1.cooperativa');   // document:read, pero alcance ASIGNADO

// Recuento del administrador (alcance de organización), para contrastar con el del técnico.
const avisosAdmin = await pedir(admin, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`)();
const documentosDelAdmin = Number(/^(\d+)/.exec(
  (avisosAdmin.body?.alerts ?? []).find((a) => a.code === 'DOCUMENTS_PENDING_ANALYSIS')?.observed ?? '0')?.[1] ?? 0);

// La organización propia del comprador, para el caso de control de su acceso legítimo.
const mias = await pedir(comprador, 'GET', '/api/v1/organizations')();
const orgComprador = exigeEntrada('organización del comprador', (mias.body?.organizations ?? mias.body ?? [])[0]?.id);

// ------------------------------------------------------------------ RESPUESTA PÚBLICA

await rev.caso('PÚBLICO: avisos anónimos, solo infraestructura', {
  pedir: pedir(null, 'GET', '/operations/alerts'), estado: 200, estructura: ['status', 'scope', 'alerts'],
  comprueba: (b) => {
    const codigos = b.alerts.map((a) => a.code).sort();
    return [b.scope === 'INFRASTRUCTURE' && JSON.stringify(codigos) === JSON.stringify([...INFRA].sort()),
      `scope=${b.scope} · avisos=${codigos.join(', ')}`];
  },
});

await rev.caso('PÚBLICO: ningún aviso de actividad de documentos ni de trabajos', {
  pedir: pedir(null, 'GET', '/operations/alerts'), estado: 200, estructura: ['alerts'],
  comprueba: (b) => {
    const presentes = OPERATIVOS.filter((c) => buscar(b, c));
    return [presentes.length === 0, presentes.length ? `APARECEN: ${presentes.join(', ')}` : 'ausentes los dos'];
  },
});

await rev.caso('PÚBLICO: sin identificadores, sin recuentos de recursos, sin organización', {
  pedir: pedir(null, 'GET', '/operations/alerts'), estado: 200, estructura: ['alerts'],
  comprueba: (b, r) => {
    const t = r.texto;
    const fallos = [];
    if (UUID.test(t)) fallos.push('contiene un UUID');
    if (/@/.test(t)) fallos.push('contiene una arroba');
    if (/\d+\s*(versión|versiones|entrega|entregas|documento|documentos)/i.test(t)) fallos.push('contiene un recuento de recursos');
    if (b.organization_id !== undefined) fallos.push('declara una organización');
    return [fallos.length === 0, fallos.length ? fallos.join('; ') : 'sin identificadores, recuentos ni organización'];
  },
});

// La revisión que /version declara tiene que ser la del candidato desplegado, no una etiqueta escrita a mano.
const shaEsperado = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

await rev.caso('PÚBLICO: /version identifica el código desplegado', {
  pedir: pedir(null, 'GET', '/version'), estado: 200,
  estructura: ['service', 'version', 'commit', 'commit_source', 'schema.known_by_code', 'schema.applied'],
  comprueba: (b) => [b.service === 'terra-link-api' && b.commit_source === 'BUILD_ARG',
    `versión=${b.version} · commit=${b.commit} (${b.commit_source}) · esquema aplicado=${b.schema.applied}`],
});

await rev.caso('CORRESPONDENCIA: la revisión desplegada es la del candidato', {
  pedir: pedir(null, 'GET', '/version'), estado: 200, estructura: ['commit'],
  comprueba: (b) => {
    // `+sucio` marca que el árbol tenía cambios sin confirmar al construir: se acepta sobre el mismo SHA.
    const base = String(b.commit ?? '').split('+')[0];
    return [base === shaEsperado, `desplegado=${b.commit} · candidato=${shaEsperado}`];
  },
});

await rev.caso('/version no acepta del cliente la identidad del código', {
  pedir: pedir(null, 'GET', '/version', { 'x-app-commit': 'cafe1234' }), estado: 200, estructura: ['commit'],
  comprueba: (b) => [b.commit !== 'cafe1234', `commit=${b.commit}, no el inyectado por cabecera`],
});

// ------------------------------------------------------------------ RESPUESTA RESTRINGIDA POR ORGANIZACIÓN

await rev.caso('RESTRINGIDO: sin sesión no se sirve', {
  pedir: pedir(null, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`), estado: 401,
});

await rev.caso('RESTRINGIDO: una cuenta de otra organización no entra', {
  pedir: pedir(comprador, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`), estado: 404,
});

await rev.caso('CONTROL: esa misma cuenta sí entra en SU organización', {
  pedir: pedir(comprador, 'GET', `/api/v1/organizations/${orgComprador}/operations/alerts`), estado: 200,
  estructura: ['scope', 'organization_id', 'alerts'],
  comprueba: (b, r) => {
    // BUYER no tiene ninguno de los dos permisos: los dos reservados y SIN número.
    const reservados = OPERATIVOS.filter((c) => buscar(b, c)?.state === 'RESTRICTED');
    const sinNumero = OPERATIVOS.every((c) => !/\d/.test(buscar(b, c)?.observed ?? '0'));
    return [b.organization_id === orgComprador && reservados.length === 2 && sinNumero && !r.texto.includes(COOP),
      `organización propia · reservados=${reservados.length}/2 · sin recuento=${sinNumero}`];
  },
});
rev.autorizadoDeControl();

await rev.caso('CONTROL: ORG_ADMIN ve la actividad de SU organización, con valor', {
  pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`), estado: 200,
  estructura: ['organization_id', 'alerts'],
  comprueba: (b) => {
    const conValor = OPERATIVOS.filter((c) => /\d/.test(buscar(b, c)?.observed ?? ''));
    return [b.organization_id === COOP && conValor.length === 2,
      `${conValor.length}/2 con recuento · documentos=«${buscar(b, 'DOCUMENTS_PENDING_ANALYSIS')?.observed}» · entregas=«${buscar(b, 'EVENT_DELIVERIES_DEAD')?.observed}»`];
  },
});

// ALCANCE: en el DESPLIEGUE esto comprueba la redacción y la cota (el técnico nunca por encima del
// administrador). **No es la prueba discriminante**: con la organización DEMO sin documentos pendientes, los
// dos recuentos son 0 y un fallo de alcance no se vería aquí. La discriminación real —un documento asignado a
// un técnico que el otro NO ve— está en `operations-alerts.int-spec.ts`, donde se puede crear el caso.
await rev.caso('ALCANCE POR RECURSO: el técnico ve su alcance declarado y nunca por encima del administrador', {
  pedir: pedir(tecnico, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`), estado: 200, estructura: ['alerts'],
  comprueba: (b) => {
    const suyo = buscar(b, 'DOCUMENTS_PENDING_ANALYSIS');
    const ok = /dentro de tu alcance/.test(suyo?.observed ?? '')
      && Number(/^(\d+)/.exec(suyo?.observed ?? '')?.[1] ?? -1) <= documentosDelAdmin;
    return [ok, `técnico=«${suyo?.observed}» · administrador contaba ${documentosDelAdmin}`];
  },
});

await rev.caso('PERMISO A PERMISO: el AUDITOR ve documentos y NO entregas, en la misma respuesta', {
  pedir: pedir(auditor, 'GET', `/api/v1/organizations/${COOP}/operations/alerts`), estado: 200, estructura: ['alerts'],
  comprueba: (b) => {
    const doc = buscar(b, 'DOCUMENTS_PENDING_ANALYSIS');       // tiene document:read  → control autorizado
    const ev = buscar(b, 'EVENT_DELIVERIES_DEAD');             // no tiene events:reprocess → reservado
    const ok = /\d/.test(doc?.observed ?? '') && ev?.state === 'RESTRICTED'
      && !/\d/.test(ev?.observed ?? '0') && ev?.action === null && (ev?.observed ?? '').includes('events:reprocess');
    return [ok, `documentos=${doc?.state} con recuento · entregas=${ev?.state} sin recuento, declara el permiso`];
  },
});

// ------------------------------------------------------------------ MÉTRICAS

await rev.caso('MÉTRICAS: sin sesión no se sirven', { pedir: pedir(null, 'GET', '/metrics'), estado: 401 });
await rev.caso('MÉTRICAS: un ORG_ADMIN tampoco: es permiso de plataforma', { pedir: pedir(admin, 'GET', '/metrics'), estado: 403 });

await rev.caso('CONTROL: la plataforma sí las obtiene, en formato de exposición', {
  pedir: pedir(plataforma, 'GET', '/metrics'), estado: 200,
  comprueba: (_b, r) => [r.texto.includes('# HELP http_server_requests_total') && r.texto.includes('dependency_up'),
    `${r.texto.split('\n').length} líneas de exposición`],
});

// MEDICIÓN REAL: se hacen peticiones conocidas y la serie tiene que subir exactamente esa cantidad.
const RUTA = '/api/v1/organizations/:orgId/producers';
const antes = serie((await pedir(plataforma, 'GET', '/metrics')()).texto, 'http_server_requests_total',
  { method: 'GET', route: RUTA, status_class: '2xx' }) ?? 0;
for (let i = 0; i < 3; i++) await pedir(admin, 'GET', `/api/v1/organizations/${COOP}/producers`)();

await rev.caso('MEDICIÓN REAL: la serie sube exactamente con las peticiones hechas', {
  pedir: pedir(plataforma, 'GET', '/metrics'), estado: 200,
  comprueba: (_b, r) => {
    const despues = serie(r.texto, 'http_server_requests_total', { method: 'GET', route: RUTA, status_class: '2xx' });
    return [despues === antes + 3, `${antes} → ${despues} (esperado ${antes + 3})`];
  },
});

await rev.caso('MÉTRICAS: las etiquetas no llevan identificadores; la ruta va en patrón', {
  pedir: pedir(plataforma, 'GET', '/metrics'), estado: 200,
  comprueba: (_b, r) => {
    const lineas = r.texto.split('\n').filter((l) => l && !l.startsWith('#'));
    const conUuid = lineas.filter((l) => UUID.test(l));
    const conArroba = lineas.filter((l) => l.includes('@'));
    const conPatron = lineas.some((l) => l.includes(`route="${RUTA}"`));
    return [conUuid.length === 0 && conArroba.length === 0 && conPatron,
      `series=${lineas.length} · con UUID=${conUuid.length} · con correo=${conArroba.length} · ruta en patrón=${conPatron}`];
  },
});

await rev.caso('MÉTRICAS: ni texto SQL ni objetivos inventados', {
  pedir: pedir(plataforma, 'GET', '/metrics'), estado: 200,
  comprueba: (_b, r) => {
    const t = r.texto.toLowerCase();
    const malos = ['slo', 'sla', 'uptime', 'document_number_enc', 'blind_index'].filter((m) => t.includes(m));
    return [malos.length === 0 && !/select .* from/i.test(r.texto), malos.length ? `aparece: ${malos.join(', ')}` : 'sin SQL, sin SLO/SLA'];
  },
});

// ------------------------------------------------------------------ TRAZAS

await rev.caso('TRAZAS: el listado no se sirve sin sesión', { pedir: pedir(null, 'GET', '/api/v1/observability/traces'), estado: 401 });
await rev.caso('TRAZAS: un ORG_ADMIN tampoco', { pedir: pedir(admin, 'GET', '/api/v1/observability/traces'), estado: 403 });

await rev.caso('CONTROL: la plataforma lista trazas y el almacén declara su límite', {
  pedir: pedir(plataforma, 'GET', '/api/v1/observability/traces'), estado: 200, estructura: ['storage', 'capacity', 'traces'],
  comprueba: (b) => [b.storage === 'IN_MEMORY_RING' && b.traces.length > 0, `almacén=${b.storage} · capacidad=${b.capacity} · trazas=${b.traces.length}`],
});

// RECORRIDO REAL: una petición con su propia correlación, y después su traza completa.
const correlacion = `rev-${randomUUID()}`;
const hecha = await pedir(admin, 'GET', `/api/v1/organizations/${COOP}/producers`, { 'x-request-id': correlacion })();
if (hecha.status !== 200) throw new Error(`la petición a trazar no respondió 200 (fue ${hecha.status})`);

await rev.caso('RECORRIDO REAL: del request_id a los tramos de base de datos', {
  pedir: pedir(plataforma, 'GET', `/api/v1/observability/traces/${correlacion}`), estado: 200,
  estructura: ['found', 'trace_id', 'spans'],
  comprueba: (b) => {
    if (b.found !== true) return [false, 'la traza no se encontró por su request_id'];
    const raiz = b.spans.find((s) => s.span_id === 'root');
    const sql = b.spans.filter((s) => s.span_id !== 'root');
    const ok = b.trace_id === correlacion
      && raiz?.attributes?.['http.route'] === RUTA
      && raiz?.attributes?.['http.status'] === 200
      && sql.length > 0 && sql.every((s) => /^(SELECT|INSERT|UPDATE|DELETE|WITH|SQL)\b/.test(s.name));
    return [ok, `raíz=«${raiz?.name}» ${b.duration_ms} ms · ${sql.length} tramos de base: ${[...new Set(sql.map((s) => s.name))].slice(0, 4).join(', ')}`];
  },
});

await rev.caso('TRAZAS: ni identidad, ni valores de SQL, ni coordenadas', {
  pedir: pedir(plataforma, 'GET', `/api/v1/observability/traces/${correlacion}`), estado: 200, estructura: ['spans'],
  comprueba: (_b, r) => {
    const t = r.texto;
    const fallos = [];
    if (/@/.test(t)) fallos.push('arroba');
    if (/values\s*\(/i.test(t) || /\bwhere\b/i.test(t)) fallos.push('fragmento de SQL');
    if (/-?\d{1,3}\.\d{4,}/.test(t)) fallos.push('posible coordenada');
    if (t.includes(COOP)) fallos.push('identificador de organización');
    return [fallos.length === 0, fallos.length ? `aparece: ${fallos.join(', ')}` : 'sin identidad, SQL ni coordenadas'];
  },
});

await rev.caso('TRAZAS: pedir una que no existe no inventa una respuesta', {
  pedir: pedir(plataforma, 'GET', `/api/v1/observability/traces/${randomUUID()}`), estado: 200, estructura: ['found'],
  comprueba: (b) => [b.found === false && b.trace_id === null, `found=${b.found}`],
});

// ------------------------------------------------------------------ CÓDIGO DESPLEGADO

await rev.caso('BUILD: el commit desplegado no se sirve a una organización', { pedir: pedir(admin, 'GET', '/api/v1/observability/build'), estado: 403 });

await rev.caso('CONTROL: la plataforma sí obtiene el código desplegado', {
  pedir: pedir(plataforma, 'GET', '/api/v1/observability/build'), estado: 200, estructura: ['service', 'migration_known_by_code'],
  comprueba: (b) => [b.service === 'terra-link-api', `migración del código=${b.migration_known_by_code} · commit=${b.commit ?? 'no declarado (APP_COMMIT ausente)'}`],
});

process.exitCode = rev.resumen();
