import type { ServerResponse } from 'http';
import { TlsFixture, json, loopbackLookup, tlsAvailable, type Controlled, type Recorded } from '../../test/tls-fixture';
import type { AnalysisRequest, ProviderOutcome } from './provider';
import { WHISP_CONTRACT, WhispSatelliteProvider } from './whisp';

// P0-028 · adaptador de Whisp contra **servidores controlados del propio equipo**.
//
// ALCANCE: D-09 **parte A**. Ninguna de estas pruebas toca el servicio real de Whisp: hablan con un servidor HTTPS
// levantado aquí que imita el contrato publicado (OpenAPI 2.3.1, consultado 2026-10-23). Toda la evidencia que
// producen es **SINTÉTICA** y está rotulada como tal. La integración contra Whisp real sigue **NO EJECUTADA**.

const describeTls = tlsAvailable ? describe : describe.skip;

const API_KEY = 'clave-sintetica-de-prueba-0001';
const GEOM = { type: 'Polygon', coordinates: [[[-79.5, -1], [-79.49, -1], [-79.49, -0.99], [-79.5, -0.99], [-79.5, -1]]] };

const CONFIG = {
  maxRequestBodySizeKb: 1024, maxPlotAreaHa: null, geometryLimitSync: 250, geometryLimitAsync: 5000,
  analysisTimeoutSyncSeconds: 90, analysisTimeoutAsyncSeconds: 600, openforisWhispVersion: '2.3.1-sintetico', geoidBaseUrl: null,
};
const PROPS_OK = { Area: 1.77, treecover_2020: 92.1, whisp_processing_metadata: { unavailable_datasets: [], risk_inputs_unavailable: [] } };
const PROPS_INCOMPLETO = {
  Area: 1.77, treecover_2020: 92.1,
  whisp_processing_metadata: { unavailable_datasets: ['RADD_alerts', 'JRC_TMF'], risk_inputs_unavailable: ['RADD_alerts'] },
};
/** Estrecha el desenlace a RESULT y falla con el motivo real si no lo es. */
const resultOf = (o: ProviderOutcome) => {
  if (o.kind !== 'RESULT') throw new Error(`Se esperaba RESULT y llegó ${o.kind} (${o.errorCode}: ${o.note})`);
  return o.result;
};
const featureCollection = (props: unknown) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: props, geometry: null }] });

describeTls('P0-028 · adaptador Whisp (servidor controlado; evidencia SINTÉTICA)', () => {
  let tls: TlsFixture;
  let srv: Controlled;
  let ajeno: Controlled;
  let ruta: (req: Recorded, res: ServerResponse) => void;

  const req = (over: Partial<AnalysisRequest> = {}): AnalysisRequest => ({
    operation: 'FOREST_COVER', geometry: GEOM, geometryType: 'POLYGON', geometryHash: 'a'.repeat(64),
    periodStart: null, periodEnd: null, credential: API_KEY,
    allowedHosts: [`destino.prueba.local:${srv.port}`], ...over,
  });
  const adapter = (over: Record<string, unknown> = {}) => new WhispSatelliteProvider({
    liveCalls: true, baseUrl: `https://destino.prueba.local:${srv.port}`, ca: tls.ca, lookup: loopbackLookup,
    timeoutMs: 4000, pollMs: 1, maxPolls: 5, sleep: async () => undefined, ...over,
  } as never);

  beforeAll(async () => {
    tls = new TlsFixture();
    ajeno = await tls.listen((_r, res) => json(res, 200, { robado: true }));
    srv = await tls.listen((r, res) => ruta(r, res));
  });
  afterAll(async () => tls?.close());
  beforeEach(() => {
    srv.recibidas.length = 0;
    ajeno.recibidas.length = 0;
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 200, { code: 'analysis_completed', data: featureCollection(PROPS_OK) });
      return json(res, 404, { code: 'not_found' });
    };
  });

  // ------------------------------------------------------------------ interruptor de llamadas reales

  it('sin el interruptor de llamadas reales no abre NINGUNA conexión', async () => {
    const o = await new WhispSatelliteProvider({ baseUrl: `https://destino.prueba.local:${srv.port}` }).analyze(req());
    expect(o).toMatchObject({ kind: 'LIVE_CALLS_DISABLED', errorCode: 'LIVE_CALLS_DISABLED' });
    expect(srv.recibidas).toHaveLength(0);
  });

  it('tener credencial no activa las llamadas: el interruptor es lo único que las habilita', async () => {
    const o = await new WhispSatelliteProvider({ baseUrl: `https://destino.prueba.local:${srv.port}` }).analyze(req({ credential: API_KEY }));
    expect(o.kind).toBe('LIVE_CALLS_DISABLED');
    expect(srv.recibidas).toHaveLength(0);
  });

  it('con el interruptor pero sin credencial no se envía la geometría', async () => {
    const o = await adapter().analyze(req({ credential: null }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_CREDENTIAL_MISSING' });
    expect(srv.recibidas).toHaveLength(0);
  });

  // ------------------------------------------------------------------ envío, estado y descarga

  it('envío síncrono: consulta los límites publicados ANTES de enviar y conserva los indicadores sin interpretar', async () => {
    const o = await adapter().analyze(req());
    expect(o.kind).toBe('RESULT');
    const r = resultOf(o);
    expect(srv.recibidas.map((x) => x.url)).toEqual(['/api/config', '/api/submit/geojson']);
    expect(srv.recibidas[1].headers['x-api-key']).toBe(API_KEY);
    expect(JSON.parse(srv.recibidas[1].body)).toMatchObject({ type: 'FeatureCollection', analysisOptions: { async: true } });
    expect(r.indicators).toMatchObject({ treecover_2020: 92.1 });
    expect(r.method).toContain(`Whisp API ${WHISP_CONTRACT.spec_version}`);
    expect(r.method).toContain('2.3.1-sintetico');
    // Lo que el contrato no declara queda nulo: no se rellena con el reloj ni con la FAQ.
    expect(r.dataset).toBeNull();
    expect(r.datasetVersion).toBeNull();
    expect(r.analysisDate).toBeNull(); // PROPS_OK no declara `processing_timestamp_utc`
    expect(r.resolutionM).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('trabajo asíncrono: 202 con token, sondeo del estado y resultado al completarse', async () => {
    let consultas = 0;
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tok-1', statusUrl: '/api/status/tok-1', featureCount: 1, processStatusMessages: ['Position 1 in queue'] } });
      if (r.url === '/api/status/tok-1') {
        consultas++;
        if (consultas < 3) return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tok-1', percent: 40, processStatusMessage: [] } });
        return json(res, 200, { code: 'analysis_completed', message: 'ok', data: featureCollection(PROPS_OK) });
      }
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req());
    expect(o.kind).toBe('RESULT');
    expect(consultas).toBe(3);
    expect(srv.recibidas.filter((x) => x.url.startsWith('/api/status/')).every((x) => x.headers['x-api-key'] === API_KEY)).toBe(true);
  });

  it('si el estado termina sin resultado, se descarga por el endpoint publicado para eso', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tok-2' } });
      if (r.url === '/api/status/tok-2') return json(res, 200, { code: 'analysis_completed', message: 'ok' });
      if (r.url === '/api/generate-geojson/tok-2') return json(res, 200, featureCollection(PROPS_OK));
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req());
    expect(o.kind).toBe('RESULT');
    expect(srv.recibidas.map((x) => x.url)).toContain('/api/generate-geojson/tok-2');
  });

  it('el `statusUrl` que devuelve el proveedor no se sigue a ciegas: la ruta se construye aquí', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') {
        // El proveedor (o alguien que lo suplante) apunta el seguimiento a OTRO host.
        return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tok-3', statusUrl: `https://prohibido.prueba.local:${ajeno.port}/api/status/tok-3` } });
      }
      if (r.url === '/api/status/tok-3') return json(res, 200, { code: 'analysis_completed', message: 'ok', data: featureCollection(PROPS_OK) });
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req());
    expect(o.kind).toBe('RESULT');
    expect(ajeno.recibidas).toHaveLength(0); // el host ajeno nunca recibe nada, ni la credencial
  });

  // ------------------------------------------------------------------ incompletitud declarada por el proveedor

  it('datasets no disponibles: el resultado es PARCIAL y conserva la lista de lo que faltó', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 200, { code: 'analysis_completed', data: featureCollection(PROPS_INCOMPLETO), processStatusMessages: ['dataset omitido'] });
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req());
    const r = resultOf(o);
    expect(r.coverageStatus).toBe('PARTIAL');
    expect(r.coverageNote).toContain('RADD_alerts');
    expect(r.coverageNote).toContain('JRC_TMF');
    expect(r.coverageNote).toContain('alimentaban su propia evaluación');
    expect(r.limitations).toContain('datasets no disponibles');
    expect(r.indicators.whisp_processing_metadata).toEqual(PROPS_INCOMPLETO.whisp_processing_metadata);
    expect(r.indicators.process_status_messages).toEqual(['dataset omitido']);
  });

  it('sin incidencias declaradas la cobertura es DESCONOCIDA, nunca COMPLETA: un 200 no es cobertura', async () => {
    const o = await adapter().analyze(req());
    const r = resultOf(o);
    expect(r.coverageStatus).toBe('UNKNOWN');
    expect(r.coverageNote).toContain('NO equivale a cobertura completa');
    expect(['COVERED']).not.toContain(r.coverageStatus);
  });

  // ------------------------------------------------------------------ errores, formatos y plazos

  it('los códigos de error del contrato se traducen a desenlaces no favorables', async () => {
    const casos: Array<[unknown, string]> = [
      [{ code: 'analysis_error', token: 't' }, 'PROVIDER_ERROR'],
      [{ code: 'analysis_timeout', token: 't' }, 'TIMEOUT'],
      [{ code: 'analysis_job_not_found', token: 't' }, 'PROVIDER_ERROR'],
      [{ code: 'estado_que_no_existe', token: 't' }, 'PROVIDER_ERROR'],
    ];
    for (const [estado, esperado] of casos) {
      ruta = (r, res) => {
        if (r.url === '/api/config') return json(res, 200, CONFIG);
        if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 't' } });
        if (r.url === '/api/status/t') return json(res, 200, estado);
        return json(res, 404, { code: 'not_found' });
      };
      expect((await adapter().analyze(req())).kind).toBe(esperado);
    }
  });

  it('un HTTP de error del proveedor no produce resultado; 429 es cupo agotado', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 429, { code: 'rate_limited' }));
    expect((await adapter().analyze(req())).kind).toBe('RATE_LIMITED');
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 503, { code: 'unavailable' }));
    expect((await adapter().analyze(req())).kind).toBe('PROVIDER_ERROR');
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 401, { code: 'unauthorized' }));
    expect((await adapter().analyze(req())).kind).toBe('PROVIDER_ERROR');
  });

  it('un formato inesperado no se interpreta: ni HTML, ni JSON fuera de contrato, ni resultado vacío', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>no soy el contrato</html>');
    };
    expect((await adapter().analyze(req()))).toMatchObject({ errorCode: 'PROVIDER_SUBMIT_UNCERTAIN' });

    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 200, { code: 'analysis_completed', data: { type: 'FeatureCollection', features: [] } }));
    expect((await adapter().analyze(req()))).toMatchObject({ errorCode: 'PROVIDER_NO_FEATURES' });

    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 202, { code: 'analysis_queued' }));
    expect((await adapter().analyze(req()))).toMatchObject({ errorCode: 'PROVIDER_SUBMIT_UNCERTAIN' });
  });

  it('si no se pueden leer los límites publicados, no se envía la geometría', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, { sin: 'contrato' }) : json(res, 200, { data: featureCollection(PROPS_OK) }));
    const o = await adapter().analyze(req());
    expect(o).toMatchObject({ errorCode: 'PROVIDER_CONFIG_UNREADABLE' });
    expect(srv.recibidas.map((x) => x.url)).toEqual(['/api/config']);
  });

  it('el tamaño máximo que declara el proveedor se respeta antes de enviar', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, { ...CONFIG, maxRequestBodySizeKb: 1 }) : json(res, 200, { data: featureCollection(PROPS_OK) }));
    const grande = { type: 'Polygon', coordinates: [Array.from({ length: 2000 }, (_, i) => [-79.5 + i * 1e-6, -1 + i * 1e-6])] };
    const o = await adapter().analyze(req({ geometry: grande }));
    expect(o).toMatchObject({ kind: 'GEOMETRY_UNSUPPORTED', errorCode: 'REQUEST_TOO_LARGE_FOR_PROVIDER' });
    expect(srv.recibidas.map((x) => x.url)).toEqual(['/api/config']);
  });

  it('el sondeo está acotado: un trabajo que nunca termina vence sin resultado', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'eterno' } });
      return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'eterno', percent: 1 } });
    };
    const o = await adapter({ maxPolls: 3 }).analyze(req());
    expect(o).toMatchObject({ kind: 'TIMEOUT', errorCode: 'PROVIDER_POLL_EXHAUSTED' });
    expect(srv.recibidas.filter((x) => x.url.startsWith('/api/status/'))).toHaveLength(3);
  });

  // ------------------------------------------------------------------ contrato 2.3.1 (sobre { code, message, data })

  it('la fecha y la versión de análisis son las que el PROVEEDOR declara en whisp_processing_metadata; si no son válidas, nulo', async () => {
    const conMeta = (meta: unknown) => { ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 200, { code: 'analysis_completed', message: 'ok', data: featureCollection({ Area: 1, whisp_processing_metadata: meta }) })); };
    conMeta({ whisp_version: '3.0.0a14', processing_timestamp_utc: '2026-06-11 01:59:15+0000' });
    const r = resultOf(await adapter().analyze(req()));
    expect(r.analysisDate?.toISOString()).toBe('2026-06-11T01:59:15.000Z');
    expect(r.method).toContain('3.0.0a14');
    conMeta({ processing_timestamp_utc: 'no es una fecha' });
    expect(resultOf(await adapter().analyze(req())).analysisDate).toBeNull();
  });

  it('un 202 trae `data.token`, no un resultado: no se confunde su `data` con un FeatureCollection', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'x1', statusUrl: '/api/status/x1', featureCount: 1 } }));
    const o = await adapter({ maxPolls: 1 }).analyze(req());
    expect(o.kind).not.toBe('RESULT');
    expect(srv.recibidas.map((x) => x.url)).toContain('/api/status/x1');
  });

  it('408 es plazo vencido y los rechazos de validación del proveedor son geometría no soportada, con su código', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 408, { code: 'analysis_timeout', message: 't' }));
    expect(await adapter().analyze(req())).toMatchObject({ kind: 'TIMEOUT', errorCode: 'PROVIDER_ANALYSIS_TIMEOUT' });
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 400, { code: 'validation_plot_too_large', message: 'v' }));
    expect(await adapter().analyze(req())).toMatchObject({ kind: 'GEOMETRY_UNSUPPORTED', errorCode: 'PROVIDER_VALIDATION_PLOT_TOO_LARGE' });
  });

  it('ni un error ni un trabajo sin terminar se traducen en un resultado sin hallazgos', async () => {
    for (const [status, body] of [[500, { code: 'analysis_error', message: 'e' }], [404, { code: 'analysis_job_not_found', message: 'n' }]] as const) {
      ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, status, body));
      const o = await adapter().analyze(req());
      expect(o.kind).not.toBe('RESULT');
    }
  });

  // ------------------------------------------------------------------ AJ-06: avance, reanudación y cancelación en el proveedor

  const completado = (res: ServerResponse) => json(res, 200, { code: 'analysis_completed', message: 'ok', data: featureCollection(PROPS_OK) });
  const hooksEspia = (cancelDesde = Infinity) => {
    const eventos: Array<{ tipo: string; valor?: unknown }> = [];
    let consultasCancel = 0;
    return {
      eventos,
      hooks: {
        onSubmitting: async () => { eventos.push({ tipo: 'enviando' }); },
        onSubmitAnswered: async () => { eventos.push({ tipo: 'respondido' }); },
        onSubmitted: async (ref: string) => { eventos.push({ tipo: 'enviado', valor: ref }); },
        onProgress: async (p: { percent: number | null; message: string | null }) => { eventos.push({ tipo: 'avance', valor: p }); },
        cancelRequested: async () => ++consultasCancel > cancelDesde,
      },
    };
  };

  it('el avance DECLARADO por el proveedor y el identificador del trabajo llegan al corredor (el porcentaje solo si lo informó)', async () => {
    let n = 0;
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-a', featureCount: 1, processStatusMessages: ['Position 1 in queue'] } });
      if (r.url === '/api/status/tk-a') {
        n++;
        if (n === 1) return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-a', percent: 42, processStatusMessage: ['procesando'] } });
        if (n === 2) return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-a' } }); // sin porcentaje
        return completado(res);
      }
      return json(res, 404, { code: 'not_found' });
    };
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ hooks }));
    expect(o.kind).toBe('RESULT');
    expect(eventos).toEqual([
      { tipo: 'enviando' },
      { tipo: 'enviado', valor: 'tk-a' },   // el identificador y el fin de la incertidumbre van juntos (una sola escritura)
      { tipo: 'avance', valor: { percent: 42, message: 'procesando' } },
      { tipo: 'avance', valor: { percent: null, message: null } },
    ]);
  });

  it('reintento con identificador: retoma la consulta SIN volver a enviar la geometría', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/status/tk-r1') return completado(res);
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req({ resumeJobRef: 'tk-r1' }));
    expect(o.kind).toBe('RESULT');
    expect(srv.recibidas.map((x) => x.url)).not.toContain('/api/submit/geojson');
    expect(srv.recibidas.some((x) => x.url === '/api/status/tk-r1' && x.headers['x-api-key'] === API_KEY)).toBe(true);
  });

  it('si el proveedor ya no reconoce el trabajo (sus resultados son temporales), se envía de nuevo y se conserva el identificador nuevo', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/status/viejo') return json(res, 404, { code: 'analysis_job_not_found', message: 'n' });
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'nuevo' } });
      if (r.url === '/api/status/nuevo') return completado(res);
      return json(res, 404, { code: 'not_found' });
    };
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ resumeJobRef: 'viejo', hooks }));
    expect(o.kind).toBe('RESULT');
    expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);
    expect(eventos.find((e) => e.tipo === 'enviado')).toEqual({ tipo: 'enviado', valor: 'nuevo' });
  });

  it('si el envío pierde su respuesta, el desenlace es INCIERTO: se anota que se estaba enviando, no se confirma ni se reenvía', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      res.socket?.destroy(); // el proveedor pudo recibir la geometría; la respuesta nunca llega
    };
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ hooks }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_SUBMIT_UNCERTAIN' });
    expect(eventos).toEqual([{ tipo: 'enviando' }]); // nunca «respondido» ni «enviado»
    expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);
  });

  it('un HTTP de error al enviar SÍ es una respuesta: no hay incertidumbre sobre si el proveedor lo recibió', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 503, { code: 'x' }));
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ hooks }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_HTTP_503' });
    expect(eventos.map((e) => e.tipo)).toEqual(['enviando', 'respondido']);
  });

  it('un 202 SIN identificador deja el envío INCIERTO: el proveedor pudo crear el trabajo, así que no es un error reintentable y la marca se conserva', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : json(res, 202, { code: 'analysis_queued', message: 'q', data: { featureCount: 1 } }));
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ hooks }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_SUBMIT_UNCERTAIN' });
    expect(eventos).toEqual([{ tipo: 'enviando' }]);   // nunca «respondido»
  });

  it('si NO se puede guardar el identificador, la marca de envío no se limpia (el siguiente intento no reenvía)', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-f' } });
      return json(res, 404, { code: 'x' });
    };
    const { eventos, hooks } = hooksEspia();
    const roto = { ...hooks, onSubmitted: async () => { throw new Error('fallo al guardar'); } };
    const o = await adapter().analyze(req({ hooks: roto }));
    expect(o.kind).toBe('PROVIDER_ERROR');
    expect(eventos.map((e) => e.tipo)).toEqual(['enviando']);       // ni «respondido» ni «enviado»
    expect(srv.recibidas.filter((x) => x.url === '/api/submit/geojson')).toHaveLength(1);
  });

  it('una respuesta síncrona con resultado cierra la incertidumbre sin identificador', async () => {
    ruta = (r, res) => (r.url === '/api/config' ? json(res, 200, CONFIG) : completado(res));
    const { eventos, hooks } = hooksEspia();
    const o = await adapter().analyze(req({ hooks }));
    expect(o.kind).toBe('RESULT');
    expect(eventos.map((e) => e.tipo)).toEqual(['enviando', 'respondido']);
  });

  it('un 404 al cancelar NO confirma la cancelación: se declara no confirmada, sin resultado y sin inventar uno favorable', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-n' } });
      if (r.url === '/api/status/tk-n/cancel') return json(res, 404, { code: 'analysis_job_not_found', message: 'n' });
      return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-n' } });
    };
    const { hooks } = hooksEspia(0);
    const o = await adapter().analyze(req({ hooks }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_CANCEL_NOT_CONFIRMED' });
    expect(o.kind).not.toBe('CANCELLED');
  });

  it('con una cancelación pedida y un trabajo que el proveedor ya no reconoce, NO se envía otro análisis', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/status/tk-v') return json(res, 404, { code: 'analysis_job_not_found', message: 'n' });
      return json(res, 500, { code: 'no_deberia_llamarse' });
    };
    const base = hooksEspia();
    const hooks = { ...base.hooks, cancelRequested: async () => true };
    // La cancelación se atiende antes de consultar; el proveedor responde 404 también a ella.
    const o = await adapter().analyze(req({ resumeJobRef: 'tk-v', hooks }));
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_CANCEL_NOT_CONFIRMED' });
    expect(srv.recibidas.map((x) => x.url)).not.toContain('/api/submit/geojson');
  });

  it('cancelación pedida: se cancela EN EL PROVEEDOR (POST /api/status/{token}/cancel) y no queda resultado', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-c' } });
      if (r.url === '/api/status/tk-c/cancel') return json(res, 200, { code: 'analysis_cancelled', message: 'c' });
      if (r.url === '/api/status/tk-c') return json(res, 202, { code: 'analysis_processing', message: 'p', data: { token: 'tk-c', percent: 10 } });
      return json(res, 404, { code: 'not_found' });
    };
    const { hooks } = hooksEspia(1); // la cancelación se pide tras la primera consulta
    const o = await adapter().analyze(req({ hooks }));
    expect(o).toMatchObject({ kind: 'CANCELLED', errorCode: 'CANCELLED_AT_PROVIDER' });
    const cancel = srv.recibidas.find((x) => x.url === '/api/status/tk-c/cancel')!;
    expect(cancel.method).toBe('POST');
    expect(cancel.headers['x-api-key']).toBe(API_KEY);
  });

  it('si el trabajo ya había terminado (409 analysis_cancel_invalid), se recoge su resultado en vez de darlo por cancelado', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tk-d' } });
      if (r.url === '/api/status/tk-d/cancel') return json(res, 409, { code: 'analysis_cancel_invalid', message: 'x' });
      if (r.url === '/api/status/tk-d') return completado(res);
      return json(res, 404, { code: 'not_found' });
    };
    const { hooks } = hooksEspia(0);
    const o = await adapter().analyze(req({ hooks }));
    expect(o.kind).toBe('RESULT');
  });

  // ------------------------------------------------------------------ política de salida y secretos

  it('la descarga pasa por la misma política de salida: una redirección no se sigue', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      if (r.url === '/api/submit/geojson') return json(res, 202, { code: 'analysis_queued', message: 'q', data: { token: 'tok-r' } });
      if (r.url === '/api/status/tok-r') return json(res, 200, { code: 'analysis_completed', message: 'ok' });
      if (r.url === '/api/generate-geojson/tok-r') { res.writeHead(302, { location: `https://prohibido.prueba.local:${ajeno.port}/robado` }); return res.end(); }
      return json(res, 404, { code: 'not_found' });
    };
    const o = await adapter().analyze(req());
    expect(o).toMatchObject({ kind: 'EGRESS_BLOCKED', errorCode: 'EGRESS_REDIRECT_NOT_FOLLOWED' });
    expect(ajeno.recibidas).toHaveLength(0);
  });

  it('un destino fuera de la lista blanca del proveedor no se llama', async () => {
    const o = await adapter().analyze(req({ allowedHosts: ['otro.host.local'] }));
    expect(o).toMatchObject({ kind: 'EGRESS_BLOCKED', errorCode: 'EGRESS_HOST_NOT_ALLOWED' });
    expect(srv.recibidas).toHaveLength(0);
  });

  it('ni la credencial ni las coordenadas aparecen en lo que se conserva del fallo', async () => {
    ruta = (r, res) => {
      if (r.url === '/api/config') return json(res, 200, CONFIG);
      // El proveedor devuelve en su error la clave y las coordenadas que recibió.
      return json(res, 500, { code: 'analysis_error', echo: { key: API_KEY, geometry: GEOM } });
    };
    const o = await adapter().analyze(req());
    const texto = JSON.stringify(o);
    expect(texto).not.toContain(API_KEY);
    expect(texto).not.toContain('-79.5');
    expect(o).toMatchObject({ kind: 'PROVIDER_ERROR', errorCode: 'PROVIDER_HTTP_500' });
  });
});
