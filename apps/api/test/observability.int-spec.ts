import { randomUUID } from 'crypto';
import { describeDb, setupHarness } from './helpers';
import { LATEST_MIGRATION } from '../src/db/database';
import { vaciarTrazas } from '../src/observability/tracing';
import { reiniciarMetricas } from '../src/observability/metrics';

// RNF-13 (S1 §77) — MÉTRICAS Y TRAZAS demostradas sobre PETICIONES REALES.
//
// «Importar una biblioteca no demuestra observabilidad.» Por eso aquí no se comprueba que exista un registro:
// se hacen peticiones de verdad contra la API del arnés y después:
//   · se LEE el texto de exposición y se comprueba que las series subieron por la petición que se hizo;
//   · se RECORRE una traza concreta desde su `request_id` hasta sus tramos de base de datos;
//   · se comprueba que en ninguno de los dos aparece nada de lo prohibido.

describeDb('RNF-13 métricas y trazas: medidas sobre peticiones reales', () => {
  let h: Awaited<ReturnType<typeof setupHarness>>;
  let org = '';
  const SUPER = 'obs-super@test.local';
  const ADMIN = 'obs-admin@test.local';

  const http = () => h.http();
  const as = (e: string) => h.as(e);
  const metricas = (actor = SUPER) => http().get('/metrics').set(as(actor));

  /** Valor de una serie concreta en el texto de exposición Prometheus. */
  const serie = (texto: string, nombre: string, etiquetas: Record<string, string>) => {
    const sel = Object.entries(etiquetas).map(([k, v]) => `${k}="${v}"`);
    for (const linea of texto.split('\n')) {
      if (!linea.startsWith(`${nombre}{`)) continue;
      if (sel.every((s) => linea.includes(s))) return Number(linea.slice(linea.lastIndexOf('}') + 1).trim());
    }
    return null;
  };

  beforeAll(async () => {
    h = await setupHarness();
    await h.user(SUPER, 'SUPER_ADMIN');
    await h.user(ADMIN);
    org = (await http().post('/api/v1/organizations').set(as(SUPER))
      .send({ name: 'Coop Observabilidad', organization_type: 'COOPERATIVE', country: 'EC', initial_admin_email: ADMIN }).expect(201)).body.id;
    await h.login(ADMIN);
  });
  afterAll(async () => h?.close());

  // ---------------------------------------------------------------- /version

  it('`/version` identifica el código desplegado, sin secretos', async () => {
    const r = await http().get('/version').expect(200);
    expect(r.body.service).toBe('terra-link-api');
    expect(typeof r.body.version).toBe('string');
    expect(r.body.schema.known_by_code).toBe(LATEST_MIGRATION);
    expect(r.body.schema.applied).toBe(LATEST_MIGRATION);
    // La revisión forma parte del contrato: `/version` tiene que decir QUÉ código corre.
    expect(r.body).toHaveProperty('commit');
    expect(r.body).toHaveProperty('commit_source');
    // Y si no se inyectó, lo DECLARA en vez de inventarla o callarla. El arnés no construye imagen.
    expect(['BUILD_ARG', 'NOT_INJECTED']).toContain(r.body.commit_source);
    if (r.body.commit_source === 'NOT_INJECTED') expect(r.body.commit).toBeNull();
    else expect(typeof r.body.commit).toBe('string');
    // Nada de secretos: una revisión no lo es, una credencial sí.
    for (const p of ['password', 'secret', 'token', 'postgres://', 'redis://', '@']) {
      expect(JSON.stringify(r.body).toLowerCase()).not.toContain(p);
    }
  });

  it('la revisión se toma del artefacto, nunca de lo que pida el cliente', async () => {
    const r = await http().get('/version').set('X-App-Commit', 'cafe1234').set('x-forwarded-commit', 'cafe1234').expect(200);
    expect(r.body.commit).not.toBe('cafe1234');
  });

  it('el commit desplegado se sirve en la ruta restringida, con control autorizado', async () => {
    await http().get('/api/v1/observability/build').expect(401);              // anónimo
    await http().get('/api/v1/observability/build').set(as(ADMIN)).expect(403); // ORG_ADMIN no es plataforma
    const r = await http().get('/api/v1/observability/build').set(as(SUPER)).expect(200);  // CONTROL
    expect(r.body).toHaveProperty('commit');
    expect(r.body.commit_source).toBe(r.body.commit ? 'BUILD_ARG' : 'NOT_INJECTED');
    expect(r.body.migration_known_by_code).toBe(LATEST_MIGRATION);
  });

  // ---------------------------------------------------------------- /metrics

  it('`/metrics` es restringido: anónimo y ORG_ADMIN no, plataforma sí', async () => {
    await http().get('/metrics').expect(401);
    await http().get('/metrics').set(as(ADMIN)).expect(403);
    const r = await metricas().expect(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    expect(r.text).toContain('# HELP http_server_requests_total');
  });

  it('MEDICIÓN REAL: la serie de una ruta sube exactamente con las peticiones que se hacen', async () => {
    reiniciarMetricas();
    const ruta = '/api/v1/organizations/:orgId/producers';
    expect(serie((await metricas()).text, 'http_server_requests_total', { route: ruta, method: 'GET', status_class: '2xx' })).toBeNull();

    for (let i = 0; i < 3; i++) await http().get(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).expect(200);
    const texto = (await metricas()).text;
    expect(serie(texto, 'http_server_requests_total', { route: ruta, method: 'GET', status_class: '2xx' })).toBe(3);

    // El histograma contó las mismas tres y publica una distribución, no un objetivo.
    expect(serie(texto, 'http_server_request_duration_seconds_count', { route: ruta, method: 'GET' })).toBe(3);
    expect(texto).toContain('# HELP http_server_request_duration_seconds');
    expect(texto).toMatch(/Distribución OBSERVADA/);
  });

  it('MEDICIÓN REAL: una denegación se cuenta como 4xx, no se pierde ni se confunde con un acierto', async () => {
    reiniciarMetricas();
    await http().get(`/api/v1/organizations/${org}/members`).set(as(SUPER)).expect(403);
    const texto = (await metricas()).text;
    const ruta = '/api/v1/organizations/:orgId/members';
    expect(serie(texto, 'http_server_requests_total', { route: ruta, status_class: '4xx' })).toBe(1);
    expect(serie(texto, 'http_server_requests_total', { route: ruta, status_class: '2xx' })).toBeNull();
  });

  it('las ETIQUETAS no llevan identificadores de persona ni de recurso', async () => {
    await http().get(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).expect(200);
    const texto = (await metricas()).text;
    // Ninguna línea de métrica contiene el identificador de la organización ni un correo.
    expect(texto).not.toContain(org);
    expect(texto).not.toContain('@test.local');
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Las rutas aparecen como patrón.
    expect(texto).toContain('route="/api/v1/organizations/:orgId/producers"');
  });

  it('las métricas de base cuentan operaciones, sin texto SQL ni valores', async () => {
    const texto = (await metricas()).text;
    expect(texto).toContain('db_queries_total');
    expect(Number(serie(texto, 'db_queries_total', { operation: 'SELECT' }) ?? 0)).toBeGreaterThan(0);
    // Ni fragmentos de consulta, ni nombres de columnas sensibles.
    expect(texto).not.toMatch(/select .* from/i);
    expect(texto).not.toContain('document_number_enc');
    expect(texto).not.toContain('blind_index');
  });

  it('el estado de dependencias y la cola del outbox se miden al recolectar, sin atribución por organización', async () => {
    const texto = (await metricas()).text;
    expect(serie(texto, 'dependency_up', { dependency: 'database' })).toBe(1);
    expect(serie(texto, 'dependency_up', { dependency: 'redis' })).toBe(1);
    expect(texto).toContain('outbox_deliveries');
    // La cola se etiqueta por ESTADO, nunca por organización.
    expect(texto).not.toMatch(/outbox_deliveries\{[^}]*organization/);
  });

  it('no inventa objetivos: ninguna métrica declara SLO, SLA ni disponibilidad comprometida', async () => {
    const texto = (await metricas()).text.toLowerCase();
    for (const inventado of ['slo', 'sla', 'uptime', 'budget', 'objetivo p95', 'disponibilidad prometida']) {
      expect(texto).not.toContain(inventado);
    }
  });

  // ---------------------------------------------------------------- TRAZAS

  it('RECORRIDO REAL: desde el request_id de una petición se llega a sus tramos de base de datos', async () => {
    vaciarTrazas();
    const correlacion = `obs-${randomUUID()}`;
    const r = await http().get(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).set('X-Request-Id', correlacion).expect(200);
    // La correlación que se pidió es la que devuelve la API: es la MISMA clave, no una nueva.
    expect(r.headers['x-request-id']).toBe(correlacion);

    // Y es la clave de la traza: se recorre sin inventar ningún identificador.
    const t = (await http().get(`/api/v1/observability/traces/${correlacion}`).set(as(SUPER)).expect(200)).body;
    expect(t.found).toBe(true);
    expect(t.trace_id).toBe(correlacion);
    expect(t.status).toBe('OK');
    expect(t.duration_ms).toBeGreaterThanOrEqual(0);

    // El tramo raíz es la petición, con la ruta en patrón.
    const raiz = t.spans.find((s: { span_id: string }) => s.span_id === 'root');
    expect(raiz.attributes['http.route']).toBe('/api/v1/organizations/:orgId/producers');
    expect(raiz.attributes['http.method']).toBe('GET');
    expect(raiz.attributes['http.status']).toBe(200);

    // Y DEBAJO están las consultas que esa petición hizo de verdad, nombradas por verbo y tabla.
    const sql = t.spans.filter((s: { span_id: string }) => s.span_id !== 'root');
    expect(sql.length).toBeGreaterThan(0);
    expect(sql.every((s: { name: string }) => /^(SELECT|INSERT|UPDATE|DELETE|WITH|SQL)\b/.test(s.name))).toBe(true);
    expect(sql.some((s: { name: string }) => s.name === 'SELECT producers')).toBe(true);
    expect(sql.every((s: { parent_id: string }) => s.parent_id === 'root')).toBe(true);
  });

  it('una traza NO contiene valores de SQL, identidad, coordenadas ni cuerpos', async () => {
    vaciarTrazas();
    const correlacion = `obs-${randomUUID()}`;
    // Una petición que escribe datos personales y geometría: el peor caso para una traza.
    const prod = (await http().post(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).set('X-Request-Id', correlacion)
      .send({ producer_code: `OBS-${randomUUID().slice(0, 6)}`, legal_name: 'Finca Trazas', document_type: 'CEDULA', document_number: '1712345678' }).expect(201)).body.id;
    const t = (await http().get(`/api/v1/observability/traces/${correlacion}`).set(as(SUPER)).expect(200)).body;
    const texto = JSON.stringify(t);

    expect(texto).not.toContain('1712345678');     // cédula
    expect(texto).not.toContain('Finca Trazas');   // nombre legal
    expect(texto).not.toContain(prod);             // identificador del recurso creado
    expect(texto).not.toContain('@test.local');    // identidad de la sesión
    expect(texto).not.toMatch(/values\s*\(/i);     // nada de SQL con valores
    expect(texto).not.toMatch(/insert into\s+"/i);
    expect(texto).not.toMatch(/-?\d{1,3}\.\d{4,}/); // nada con pinta de coordenada
  });

  it('un error queda trazado por su CLASE, nunca por su mensaje', async () => {
    vaciarTrazas();
    const correlacion = `obs-${randomUUID()}`;
    await http().get(`/api/v1/organizations/${org}/members`).set(as(SUPER)).set('X-Request-Id', correlacion).expect(403);
    const t = (await http().get(`/api/v1/observability/traces/${correlacion}`).set(as(SUPER)).expect(200)).body;
    expect(t.found).toBe(true);
    expect(t.status).toBe('ERROR');
    const raiz = t.spans.find((s: { span_id: string }) => s.span_id === 'root');
    expect(raiz.attributes['http.status']).toBe(403);
    expect(raiz.attributes['error.kind']).toBe('http_403');
    // Ni mensaje, ni pila.
    expect(JSON.stringify(t)).not.toMatch(/stack|at Object|No tienes permiso/i);
  });

  it('el listado de trazas es restringido y declara sus límites sin fingir un backend', async () => {
    await http().get('/api/v1/observability/traces').expect(401);
    await http().get('/api/v1/observability/traces').set(as(ADMIN)).expect(403);
    const r = await http().get('/api/v1/observability/traces').set(as(SUPER)).expect(200);  // CONTROL
    expect(r.body.storage).toBe('IN_MEMORY_RING');
    expect(r.body.capacity).toBe(200);
    expect(r.body.note).toMatch(/No persistidas|no exportadas/i);
    expect(Array.isArray(r.body.traces)).toBe(true);
    expect(r.body.traces.length).toBeGreaterThan(0);
  });

  it('pedir una traza que no está no inventa una respuesta', async () => {
    const r = await http().get(`/api/v1/observability/traces/${randomUUID()}`).set(as(SUPER)).expect(200);
    expect(r.body.found).toBe(false);
    expect(r.body.trace_id).toBeNull();
    expect(r.body.note).toMatch(/anillo/i);
  });

  it('la instrumentación no altera el comportamiento: la misma petición responde igual con y sin correlación propia', async () => {
    const conId = await http().get(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).set('X-Request-Id', `obs-${randomUUID()}`).expect(200);
    const sinId = await http().get(`/api/v1/organizations/${org}/producers`).set(as(ADMIN)).expect(200);
    expect(sinId.body).toEqual(conId.body);
    expect(sinId.headers['x-request-id']).toBeTruthy();  // la API genera una si no se la dan
  });
});
