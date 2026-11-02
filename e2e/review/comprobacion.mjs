// Comprobaciones de revisión que NO pueden salir «OK» por accidente.
//
// Corrige cuatro formas de resultado vacuo que se dieron el 2026-10-16 al revisar el despliegue:
//   1. Una petición a una **ruta inventada** devolvió 404 y, como el cuerpo no traía el dato buscado, la
//      comprobación «la definición no aparece» salió OK. No aparecía porque no había respuesta.
//   2. Se comprobó un campo **ausente** (`entity`/`field` no venían en esa respuesta) y se informó como válido.
//   3. Se comparó contra una referencia **`undefined`**: la consulta que debía traerla no devolvió filas, así
//      que el caso «referencia ajena» se ejecutó con `undefined` y «pasó».
//   4. Se probaron solo **denegaciones**, sin un caso autorizado de control: si el servicio estuviera caído,
//      todas las denegaciones «pasarían» igual.
//
// Reglas que impone este módulo:
//   · Ningún OK si el estado HTTP no es el esperado.
//   · Ninguna comprobación sobre un valor ausente (`undefined`/`null`) ni sobre una entrada sin definir.
//   · La respuesta debe traer la estructura declarada antes de mirar su contenido.
//   · Un grupo que prueba denegaciones **exige** al menos un caso autorizado de control.
//
// No publica secretos ni respuestas completas: solo el nombre del caso, el estado y el detalle declarado.
// Las credenciales se leen con la utilidad segura (`consulta-api.mjs`), nunca se imprimen.

/** Valor presente de verdad. `0`, `''` y `false` son presentes; `undefined` y `null` no. */
export function presente(v) {
  return v !== undefined && v !== null;
}

/**
 * Exige que un dato de ENTRADA exista antes de usarlo en un caso. Sin esto, un identificador que la consulta
 * previa no encontró se cuela como `undefined` y el caso se ejecuta contra la nada.
 */
export function exigeEntrada(nombre, valor) {
  if (!presente(valor) || valor === '') {
    throw new Error(`entrada ausente: ${nombre}. La comprobación NO se ejecuta con un valor indefinido.`);
  }
  return valor;
}

/** Comprueba que el cuerpo traiga las claves declaradas (admite rutas «a.b.c»). Devuelve las que faltan. */
export function faltanClaves(cuerpo, claves) {
  const falta = [];
  for (const ruta of claves) {
    let v = cuerpo;
    for (const parte of ruta.split('.')) v = presente(v) ? v[parte] : undefined;
    if (!presente(v)) falta.push(ruta);
  }
  return falta;
}

/**
 * Revisión con casos. Cada caso declara el estado HTTP esperado y, si va a mirar el cuerpo, su estructura.
 *
 *   const rev = crearRevision('compuertas servidas');
 *   await rev.caso('catálogo servido', { pedir: () => get('/kde-catalog'), estado: 200,
 *     estructura: ['current_release.version'], comprueba: (b) => [b.current_release.version === '1.7.0', `versión=${b.current_release.version}`] });
 *   rev.autorizadoDeControl();           // marca que hubo control
 *   process.exitCode = rev.resumen();
 */
export function crearRevision(nombre) {
  const casos = [];
  let huboDenegacion = false;
  let huboControlAutorizado = false;

  async function caso(titulo, { pedir, estado, estructura = [], comprueba }) {
    let r;
    try {
      r = await pedir();
    } catch (e) {
      casos.push({ titulo, ok: false, detalle: `la petición falló: ${e.message}` });
      return null;
    }
    if (!presente(r) || !presente(r.status)) {
      casos.push({ titulo, ok: false, detalle: 'la petición no devolvió un estado HTTP' });
      return null;
    }
    // Regla 1: el estado manda. Sin el estado esperado no se mira el cuerpo ni se concede OK.
    if (r.status !== estado) {
      casos.push({ titulo, ok: false, detalle: `estado ${r.status}, esperado ${estado}` });
      return null;
    }
    if (estado >= 400) huboDenegacion = true;
    // Regla 3: estructura declarada antes de mirar contenido.
    if (estructura.length) {
      const falta = faltanClaves(r.body, estructura);
      if (falta.length) {
        casos.push({ titulo, ok: false, detalle: `estado ${r.status} pero faltan en la respuesta: ${falta.join(', ')}` });
        return null;
      }
    }
    if (!comprueba) {
      casos.push({ titulo, ok: true, detalle: `estado ${r.status}` });
      return r;
    }
    // Regla 2: si la comprobación mira un valor ausente, es FALLA, no OK.
    let ok;
    let detalle;
    try {
      [ok, detalle] = comprueba(r.body, r);
    } catch (e) {
      casos.push({ titulo, ok: false, detalle: `la comprobación no pudo evaluarse: ${e.message}` });
      return null;
    }
    if (!presente(ok)) {
      casos.push({ titulo, ok: false, detalle: 'la comprobación no devolvió un veredicto' });
      return null;
    }
    casos.push({ titulo, ok: !!ok, detalle: `estado ${r.status} · ${detalle ?? ''}`.trim() });
    return r;
  }

  /** Declara que en este grupo hubo un caso AUTORIZADO que funcionó: sin él, las denegaciones no prueban nada. */
  function autorizadoDeControl() {
    huboControlAutorizado = true;
  }

  function resumen() {
    for (const c of casos) console.log(`${c.ok ? 'OK   ' : 'FALLA'} ${c.titulo.padEnd(58)} ${c.detalle}`);
    let ok = casos.length > 0 && casos.every((c) => c.ok);
    if (casos.length === 0) console.log('FALLA (ningún caso ejecutado: una revisión sin casos no aprueba)');
    // Regla 4: denegaciones sin control autorizado no acreditan nada.
    if (huboDenegacion && !huboControlAutorizado) {
      console.log('FALLA (se probaron denegaciones sin un caso autorizado de control: no se puede distinguir');
      console.log('       «deniega correctamente» de «el servicio no responde»)');
      ok = false;
    }
    console.log(`\n${nombre}: ${ok ? 'APROBADO' : 'CON FALLAS'} (${casos.filter((c) => c.ok).length}/${casos.length} casos)`);
    return ok ? 0 : 1;
  }

  return { caso, autorizadoDeControl, resumen };
}
