// Comprobación del ARNÉS de carga contra un servidor CONTROLADO (http local en un puerto efímero, creado por la propia prueba).
// Comprueba la herramienta, no el rendimiento de Terra Link. No usa el DEMO, ni servicios externos, ni usuarios, ni tokens reales.
//   node --test scripts/carga-piloto.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { ejecutar, percentil, resumenMarkdown, validarConfig } from './carga-piloto.mjs';

const TOKEN_FALSO = 'TOKEN-SINTETICO-NO-REAL-9f3a';
let servidor; let base; const cabecerasRecibidas = []; let contadorIntermitente = 0;
before(async () => {
  servidor = createServer((req, res) => {
    cabecerasRecibidas.push(req.headers.authorization ?? null);
    const url = new URL(req.url, 'http://x');
    const fin = (estado, ms = 0, cuerpo = '{}') => setTimeout(() => { res.writeHead(estado, { 'content-type': 'application/json' }); res.end(cuerpo); }, ms);
    if (url.pathname === '/rapido') return fin(200, 2);
    if (url.pathname === '/lento') return fin(200, 40);
    if (url.pathname === '/falla-rapido') return fin(500, 0); // responde en ~1 ms con error: NO es satisfactorio
    if (url.pathname === '/colgado') return undefined; // nunca responde: timeout
    if (url.pathname === '/intermitente') { contadorIntermitente += 1; return fin(contadorIntermitente % 4 === 0 ? 503 : 200, 3); }
    return fin(404);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => { servidor.closeAllConnections?.(); servidor.close(); });

const cfgBase = (over = {}) => ({
  entorno: { etiqueta: 'servidor controlado de la prueba', descripcion: 'http local efímero creado por la prueba', representativo_del_piloto: false },
  destino: { base_url: base, permitir_no_local: false },
  dataset: { descripcion: 'ninguno (servidor sintético)', productores: 0, parcelas: 0, lotes: 0 },
  carga: { concurrencia: 4, duracion_s: 1, calentamiento_s: 0.2, timeout_ms: 300, semilla: 7 },
  autenticacion: { tipo: 'ninguna' },
  operaciones: [{ nombre: 'rapido', clase: 'prueba', metodo: 'GET', ruta: '/rapido', esperado: [200], peso: 1 }],
  ...over,
});

describe('arnés de carga: la herramienta, contra un servidor controlado', () => {
  it('percentil por rango más cercano', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentil(v, 50), 50); assert.equal(percentil(v, 95), 95); assert.equal(percentil(v, 99), 99); assert.equal(percentil(v, 100), 100);
    assert.equal(percentil([], 95), null); assert.equal(percentil([7], 95), 7);
  });

  it('mide latencias y muestras de operaciones satisfactorias; sin objetivos INFORMA y no emite veredicto ni aprobación', async () => {
    const r = await ejecutar(cfgBase());
    const o = r.por_operacion[0];
    assert.ok(o.total >= 20, `muestras suficientes: ${o.total}`);
    assert.equal(o.fallos, 0); assert.equal(o.satisfactorias, o.total); assert.equal(o.tasa_error, 0);
    const l = o.latencia_ms_satisfactorias;
    assert.ok(l.p50 >= 2 && l.p50 <= l.p95 && l.p95 <= l.p99 && l.p99 <= l.max, JSON.stringify(l));
    assert.match(r.veredicto, /^SIN_OBJETIVOS_CONFIGURADOS/);
    assert.deepEqual(r.comparacion_con_objetivos.map((c) => c.estado), ['SIN_OBJETIVO']);
    assert.doesNotMatch(JSON.stringify(r) + resumenMarkdown(r), /aprobad/i); // el arnés nunca emite «aprobado»
    assert.match(r.aviso_entorno, /NO REPRESENTATIVO/);
  });

  it('un fallo RÁPIDO no cuenta como respuesta satisfactoria: 0 satisfactorias, error 100 %, p95 penalizado = timeout; con objetivo generoso NO cumple por la tasa de error', async () => {
    const r = await ejecutar(cfgBase({
      operaciones: [{ nombre: 'falla', clase: 'prueba', metodo: 'GET', ruta: '/falla-rapido', esperado: [200], peso: 1 }],
      objetivos: { falla: { p95_ms: 100000, max_tasa_error: 0.01, min_muestras: 10 } },
    }));
    const o = r.por_operacion[0];
    assert.equal(o.satisfactorias, 0); assert.equal(o.tasa_error, 1); assert.ok(o.causas_de_fallo.http_500 === o.total);
    assert.ok(o.latencia_ms_de_los_fallos.p95 < 50, 'el fallo fue rápido (no lo convierte en éxito)');
    assert.equal(o.p95_ms_penalizado, 300); // cada fallo cuenta con el timeout completo
    assert.equal(r.comparacion_con_objetivos[0].estado, 'NO_CUMPLE_OBJETIVO_DE_ENTRADA');
    assert.match(r.comparacion_con_objetivos[0].motivos.join(' '), /tasa de error/);
  });

  it('timeouts y errores de red se clasifican y cuentan como fallos', async () => {
    const r = await ejecutar(cfgBase({
      carga: { concurrencia: 4, duracion_s: 1, calentamiento_s: 0, timeout_ms: 150, semilla: 3 },
      operaciones: [
        { nombre: 'colgado', clase: 'prueba', metodo: 'GET', ruta: '/colgado', esperado: [200], peso: 1 },
        { nombre: 'sin-ruta', clase: 'prueba', metodo: 'GET', ruta: '/no-existe', esperado: [200], peso: 1 },
      ],
    }));
    const c = r.por_operacion.find((o) => o.operacion === 'colgado');
    assert.ok(c.total >= 4 && c.satisfactorias === 0 && c.causas_de_fallo.timeout === c.total, JSON.stringify(c));
    assert.ok(c.latencia_ms_de_los_fallos.min >= 140, 'el timeout tardó el timeout configurado');
    const n = r.por_operacion.find((o) => o.operacion === 'sin-ruta');
    assert.equal(n.causas_de_fallo.http_404, n.total); assert.equal(n.satisfactorias, 0);
  });

  it('objetivos de entrada: se compara con el p95 penalizado; ni el cumplimiento ni el incumplimiento son una aceptación', async () => {
    const op = [{ nombre: 'lento', clase: 'prueba', metodo: 'GET', ruta: '/lento', esperado: [200], peso: 1 }];
    const no = await ejecutar(cfgBase({ operaciones: op, objetivos: { lento: { p95_ms: 5, max_tasa_error: 0.5, min_muestras: 5 } } }));
    assert.equal(no.comparacion_con_objetivos[0].estado, 'NO_CUMPLE_OBJETIVO_DE_ENTRADA');
    const si = await ejecutar(cfgBase({ operaciones: op, objetivos: { lento: { p95_ms: 5000, max_tasa_error: 0.5, min_muestras: 5 } } }));
    assert.equal(si.comparacion_con_objetivos[0].estado, 'CUMPLE_OBJETIVO_DE_ENTRADA');
    assert.match(si.veredicto, /NO es una aceptación/);
    const poco = await ejecutar(cfgBase({ operaciones: op, objetivos: { lento: { p95_ms: 5000, max_tasa_error: 0.5, min_muestras: 100000 } } }));
    assert.equal(poco.comparacion_con_objetivos[0].estado, 'MUESTRAS_INSUFICIENTES');
  });

  it('operación intermitente: la tasa de error refleja los 503 y las satisfactorias solo los 200', async () => {
    contadorIntermitente = 0;
    const r = await ejecutar(cfgBase({ carga: { concurrencia: 1, duracion_s: 1, calentamiento_s: 0, timeout_ms: 300, semilla: 1 }, operaciones: [{ nombre: 'inter', clase: 'prueba', metodo: 'GET', ruta: '/intermitente', esperado: [200], peso: 1 }] }));
    const o = r.por_operacion[0];
    assert.ok(o.tasa_error > 0.2 && o.tasa_error < 0.3, `~25 % de 503: ${o.tasa_error}`);
    assert.equal(o.causas_de_fallo.http_503, o.fallos); assert.equal(o.satisfactorias + o.fallos, o.total);
  });

  it('configuración: sin entradas explícitas no corre; rechaza el DEMO local, destinos no locales sin confirmación y escrituras sin declarar', () => {
    const vacia = validarConfig({ entorno: {}, destino: {}, dataset: {}, carga: {}, autenticacion: {}, operaciones: [] });
    for (const campo of ['entorno.etiqueta', 'representativo_del_piloto', 'carga.concurrencia', 'carga.duracion_s', 'carga.timeout_ms', 'dataset.parcelas', 'operaciones']) assert.ok(vacia.some((m) => m.includes(campo)), campo);
    assert.ok(validarConfig(cfgBase({ destino: { base_url: 'http://127.0.0.1:4000' } })).some((m) => /DEMO local/.test(m)));
    assert.ok(validarConfig(cfgBase({ destino: { base_url: 'http://localhost:3000' } })).some((m) => /DEMO local/.test(m)));
    assert.ok(validarConfig(cfgBase({ destino: { base_url: 'https://externo.example.org' } })).some((m) => /no es local/.test(m)));
    assert.ok(validarConfig(cfgBase({ destino: { base_url: 'https://piloto.example.org', permitir_no_local: true } }), {}).some((m) => /TL_CARGA_CONFIRMA_DESTINO/.test(m)));
    assert.deepEqual(validarConfig(cfgBase({ destino: { base_url: 'https://piloto.example.org', permitir_no_local: true } }), { TL_CARGA_CONFIRMA_DESTINO: 'piloto.example.org' }), []);
    const escribe = cfgBase({ operaciones: [{ nombre: 'crea', clase: 'x', metodo: 'POST', ruta: '/x', esperado: [201], peso: 1 }] });
    assert.ok(validarConfig(escribe).some((m) => /escribe en el destino/.test(m)));
    assert.deepEqual(validarConfig({ ...escribe, permitir_mutaciones: true, operaciones: [{ ...escribe.operaciones[0], mutante: true }] }), []);
    assert.ok(validarConfig(cfgBase({ operaciones: [{ nombre: 'a', clase: 'x', metodo: 'GET', ruta: '/{orgId}', esperado: [200], peso: 1 }] })).some((m) => /falta la variable \{orgId\}/.test(m)));
    assert.ok(validarConfig(cfgBase({ objetivos: { rapido: { p95_ms: 10 } } })).some((m) => /max_tasa_error/.test(m)));
    assert.ok(validarConfig(cfgBase({ objetivos: { fantasma: { p95_ms: 10, max_tasa_error: 0, min_muestras: 1 } } })).some((m) => /no corresponde/.test(m)));
  });

  it('la plantilla del piloto NO es utilizable tal cual (todo lo que decide el responsable está sin completar)', () => {
    const plantilla = JSON.parse(readFileSync(new URL('./carga-piloto.plantilla.json', import.meta.url), 'utf8'));
    const errores = validarConfig(plantilla, { TL_CARGA_TOKEN: 'x' });
    assert.ok(errores.length >= 8, `la plantilla exige completar: ${errores.length} entradas`);
    assert.deepEqual(plantilla.objetivos, {}); // ningún objetivo viene precargado
  });

  it('el token se usa pero no se imprime, no se guarda y no aparece en el resultado; la CLI valida sin enviar peticiones', async () => {
    cabecerasRecibidas.length = 0;
    const cfg = cfgBase({ autenticacion: { tipo: 'bearer_env', variable: 'TL_CARGA_TOKEN_PRUEBA' }, guardar_muestras: true });
    const r = await ejecutar(cfg, { env: { TL_CARGA_TOKEN_PRUEBA: TOKEN_FALSO } });
    assert.ok(cabecerasRecibidas.length > 0 && cabecerasRecibidas.every((h) => h === `Bearer ${TOKEN_FALSO}`), 'el servidor recibió el token en la cabecera');
    assert.ok(!JSON.stringify(r).includes(TOKEN_FALSO) && !resumenMarkdown(r).includes(TOKEN_FALSO));
    // CLI: --validar no abre ninguna conexión y no escribe resultados
    const dir = mkdtempSync(join(tmpdir(), 'carga-'));
    const archivo = join(dir, 'c.json');
    (await import('node:fs')).writeFileSync(archivo, JSON.stringify(cfgBase()));
    const antes = cabecerasRecibidas.length;
    const arnes = fileURLToPath(new URL('./carga-piloto.mjs', import.meta.url));
    const sal = spawnSync(process.execPath, [arnes, '--config', archivo, '--validar'], { encoding: 'utf8' });
    assert.equal(sal.status, 0, sal.stderr); assert.match(sal.stdout, /No se envió ninguna petición/);
    assert.equal(cabecerasRecibidas.length, antes);
    const mala = join(dir, 'mala.json');
    (await import('node:fs')).writeFileSync(mala, JSON.stringify({ ...cfgBase(), destino: { base_url: 'http://127.0.0.1:4000' } }));
    const rechazo = spawnSync(process.execPath, [arnes, '--config', mala], { encoding: 'utf8' });
    assert.equal(rechazo.status, 2); assert.match(rechazo.stderr, /DEMO local/);
    assert.deepEqual(readdirSync(dir).sort(), ['c.json', 'mala.json']);
  });

  it('la CLI completa corre contra el servidor controlado y escribe resultado.json y resumen.md sin el token', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'carga-cli-'));
    const archivo = join(dir, 'c.json');
    (await import('node:fs')).writeFileSync(archivo, JSON.stringify(cfgBase({ autenticacion: { tipo: 'bearer_env', variable: 'TL_CARGA_TOKEN_PRUEBA' } })));
    const salida = join(dir, 'salida');
    const arnes = fileURLToPath(new URL('./carga-piloto.mjs', import.meta.url));
    const { spawn } = await import('node:child_process'); // asíncrono: el servidor de la prueba vive en este proceso
    const res = await new Promise((resolve) => {
      let out = ''; let err = '';
      const p = spawn(process.execPath, [arnes, '--config', archivo, '--salida', salida], { env: { ...process.env, TL_CARGA_TOKEN_PRUEBA: TOKEN_FALSO } });
      p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { err += d; });
      p.on('close', (code) => resolve({ code, out, err }));
    });
    assert.equal(res.code, 0, res.err);
    assert.deepEqual(readdirSync(salida).sort(), ['resultado.json', 'resumen.md']);
    const json = readFileSync(join(salida, 'resultado.json'), 'utf8');
    const md = readFileSync(join(salida, 'resumen.md'), 'utf8');
    for (const t of [json, md, res.out, res.err]) assert.ok(!t.includes(TOKEN_FALSO), 'el token no aparece en ninguna salida');
    assert.match(md, /SIN_OBJETIVOS_CONFIGURADOS/); assert.match(JSON.parse(json).veredicto, /sin veredicto/);
  });
});

// Pruebas de frontera (corrección acotada del arnés). Transporte y reloj SIMULADOS: sin red, sin DEMO, sin servicios externos.
// Reloj virtual: cada petición avanza `msPorPeticion` milisegundos exactos, de modo que el número de muestras y sus latencias son deterministas.
function mundoSimulado({ msPorPeticion, falla = () => false }) {
  let t = 0; let n = 0;
  return {
    reloj: () => t,
    fetchImpl: async () => { const i = n; n += 1; t += msPorPeticion; return { status: falla(i) ? 500 : 200, arrayBuffer: async () => new ArrayBuffer(0) }; },
  };
}
const cfgFrontera = (over = {}) => ({
  entorno: { etiqueta: 'transporte simulado', descripcion: 'sin red', representativo_del_piloto: false },
  destino: { base_url: 'http://127.0.0.1:59999' },
  dataset: { descripcion: 'ninguno', productores: 0, parcelas: 0, lotes: 0 },
  carga: { concurrencia: 1, duracion_s: 1, calentamiento_s: 0, timeout_ms: 5000, semilla: 1 },
  autenticacion: { tipo: 'ninguna' },
  operaciones: [{ nombre: 'op', clase: 'prueba', metodo: 'GET', ruta: '/x', esperado: [200], peso: 1 }],
  ...over,
});

describe('arnés de carga: fronteras de precisión y entradas peligrosas', () => {
  it('latencia apenas superior al objetivo NO cumple (el redondeo de pantalla no decide la comparación)', async () => {
    const m = mundoSimulado({ msPorPeticion: 100.004 });
    const r = await ejecutar(cfgFrontera({ objetivos: { op: { p95_ms: 100, max_tasa_error: 0.5, min_muestras: 5 } } }), m);
    assert.ok(r.por_operacion[0].total >= 5);
    assert.equal(r.comparacion_con_objetivos[0].estado, 'NO_CUMPLE_OBJETIVO_DE_ENTRADA', JSON.stringify(r.comparacion_con_objetivos[0]));
    assert.match(r.comparacion_con_objetivos[0].motivos.join(' '), /p95/);
    // y exactamente en el objetivo sí cumple (la frontera es «mayor que», no «mayor o igual»)
    const igual = await ejecutar(cfgFrontera({ objetivos: { op: { p95_ms: 100, max_tasa_error: 0.5, min_muestras: 5 } } }), mundoSimulado({ msPorPeticion: 100 }));
    assert.equal(igual.comparacion_con_objetivos[0].estado, 'CUMPLE_OBJETIVO_DE_ENTRADA');
  });

  it('tasa de error apenas superior al objetivo NO cumple (1 fallo de 3 = 0,33333333… frente a 0,3333333)', async () => {
    const m = mundoSimulado({ msPorPeticion: 1, falla: (i) => i === 0 });
    const r = await ejecutar(cfgFrontera({ carga: { concurrencia: 1, duracion_s: 0.003, calentamiento_s: 0, timeout_ms: 5000, semilla: 1 }, objetivos: { op: { p95_ms: 100000, max_tasa_error: 0.3333333, min_muestras: 3 } } }), m);
    const o = r.por_operacion[0];
    assert.equal(o.total, 3); assert.equal(o.fallos, 1);
    assert.equal(r.comparacion_con_objetivos[0].estado, 'NO_CUMPLE_OBJETIVO_DE_ENTRADA', JSON.stringify(r.comparacion_con_objetivos[0]));
    assert.match(r.comparacion_con_objetivos[0].motivos.join(' '), /tasa de error/);
    // exactamente en el objetivo sí cumple: 1 fallo de 4 = 0,25 frente a 0,25 (la frontera es «mayor que»)
    const justo = await ejecutar(cfgFrontera({ carga: { concurrencia: 1, duracion_s: 0.004, calentamiento_s: 0, timeout_ms: 5000, semilla: 1 }, objetivos: { op: { p95_ms: 100000, max_tasa_error: 0.25, min_muestras: 4 } } }), mundoSimulado({ msPorPeticion: 1, falla: (i) => i === 0 }));
    assert.equal(justo.por_operacion[0].total, 4);
    assert.equal(justo.comparacion_con_objetivos[0].estado, 'CUMPLE_OBJETIVO_DE_ENTRADA');
  });

  it('el redondeo es solo de presentación: el resultado conserva los valores que se compararon', async () => {
    const r = await ejecutar(cfgFrontera({ objetivos: { op: { p95_ms: 100, max_tasa_error: 0.5, min_muestras: 5 } } }), mundoSimulado({ msPorPeticion: 100.004 }));
    const c = r.comparacion_con_objetivos[0];
    assert.ok(c.valores_comparados && c.valores_comparados.p95_penalizado_ms > 100 && c.valores_comparados.p95_penalizado_ms < 100.01, JSON.stringify(c.valores_comparados));
    assert.equal(c.valores_comparados.tasa_error, 0);
    assert.ok(resumenMarkdown(r).includes('100')); // lo mostrado puede estar redondeado
  });

  it('rechaza base_url con usuario o contraseña (artificiales), query o fragmento: la base se concatena con las rutas y se repite en el resultado', () => {
    const con = (u) => validarConfig(cfgFrontera({ destino: { base_url: u } }));
    assert.ok(con('http://usuario-falso:clave-falsa@127.0.0.1:59999').some((m) => /usuario|contraseña|credenciales/i.test(m)), 'usuario y contraseña');
    assert.ok(con('http://usuario-falso@127.0.0.1:59999').some((m) => /usuario|credenciales/i.test(m)), 'solo usuario');
    assert.ok(con('http://127.0.0.1:59999?x=1').some((m) => /query/i.test(m)), 'query');
    assert.ok(con('http://127.0.0.1:59999/#a').some((m) => /fragmento/i.test(m)), 'fragmento');
    assert.ok(con('http://127.0.0.1:59999/?').some((m) => /query/i.test(m)), 'query vacía');
    assert.deepEqual(con('http://127.0.0.1:59999'), []);
    assert.deepEqual(con('http://127.0.0.1:59999/prefijo'), []); // un prefijo de ruta sí es legítimo
  });

  it('rechaza valores numéricos no finitos (duración infinita, NaN, 1e999 leído de JSON)', () => {
    const infinita = validarConfig(cfgFrontera({ carga: { concurrencia: 1, duracion_s: Infinity, calentamiento_s: 0, timeout_ms: 5000 } }));
    assert.ok(infinita.some((m) => /duracion_s/.test(m)), 'duración infinita: ' + JSON.stringify(infinita));
    const json = JSON.parse('{"x": 1e999}'); assert.equal(json.x, Infinity); // JSON válido que produce Infinity
    assert.ok(validarConfig(cfgFrontera({ carga: { concurrencia: 1, duracion_s: json.x, calentamiento_s: 0, timeout_ms: 5000 } })).some((m) => /duracion_s/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ carga: { concurrencia: 1, duracion_s: 1, calentamiento_s: Infinity, timeout_ms: 5000 } })).some((m) => /calentamiento_s/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ carga: { concurrencia: 1, duracion_s: NaN, calentamiento_s: 0, timeout_ms: 5000 } })).some((m) => /duracion_s/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ operaciones: [{ nombre: 'op', clase: 'p', metodo: 'GET', ruta: '/x', esperado: [200], peso: Infinity }] })).some((m) => /peso/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ objetivos: { op: { p95_ms: Infinity, max_tasa_error: 0.1, min_muestras: 1 } } })).some((m) => /p95_ms/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ objetivos: { op: { p95_ms: 10, max_tasa_error: NaN, min_muestras: 1 } } })).some((m) => /max_tasa_error/.test(m)));
    assert.ok(validarConfig(cfgFrontera({ objetivos: { op: { p95_ms: 10, max_tasa_error: 0.1, min_muestras: Infinity } } })).some((m) => /min_muestras/.test(m)));
    assert.deepEqual(validarConfig(cfgFrontera()), []); // control: la configuración finita es válida
  });
});
