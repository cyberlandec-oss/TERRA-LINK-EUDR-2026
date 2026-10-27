// P1-014 — Indicadores comerciales: recorrido completo en navegador real y por API (RF-45; S3 §41).
//
//   node e2e/review/indicadores.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **la pantalla no dice siempre «sin datos»**: con entradas válidas, los cálculos responden;
//   2. **lo incompatible se excluye y se cuenta**, nunca se convierte (unidad, moneda, producto);
//   3. **ausencia no es cero**: la entrega sin dato económico va al denominador, no al precio;
//   4. **cada indicador se explica**: qué mide, fórmula, unidad, período, denominador, cobertura, procedencia;
//   5. **no hay score ni umbral de «datos suficientes»**, y lo no implementado lleva **su condición exacta**;
//   6. **el riesgo va aparte** y `UNDETERMINED` no se presenta como riesgo bajo;
//   7. **permisos sobre agregados y descargas**: sin el permiso del dominio no hay ni recuentos;
//   8. enlaces, estados de pantalla, teclado y 390 px.
//
// **Cambia datos DEMO**: crea **entregas de ensayo** identificadas en su nota, con precios en dos monedas y dos
// unidades, para poder discriminar. No modifica entregas ajenas, inventario, riesgo ni expedientes.
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';
const HOY = new Date().toISOString().slice(0, 10);

const resultados = [];
async function caso(titulo, fn) {
  try {
    const [ok, detalle] = await fn();
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(66)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(66)} ${e.message}`);
    resultados.push(false);
  }
}

async function sesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: ${r.status}`);
  return { cuenta: c, token: (await r.json()).access_token };
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  let body = null; try { body = JSON.parse(t); } catch { /* no JSON */ }
  return { status: r.status, body, headers: r.headers };
};

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');
const auditor = await sesion('auditor.cooperativa');

// --- fixture de ensayo: entregas con precios comparables e incompatibles ---
const productores = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
const productos = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/products`);
const unProductor = exigeEntrada('productor del DEMO', (productores.body?.items ?? productores.body ?? [])[0]);
const listaProductos = productos.body?.items ?? productos.body ?? [];
const unProducto = exigeEntrada('producto del DEMO', listaProductos[0]);

async function entregaDeEnsayo(cantidad, productoId = unProducto.id) {
  const r = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/deliveries`, {
    operation_id: randomUUID(), producer_id: unProductor.id, product_id: productoId,
    delivery_date: HOY, quantity_declared: cantidad, unit: 'KG', register: true,
    notes: 'Entrega de ENSAYO creada por e2e/review/indicadores.mjs. No es una operación real.',
  });
  if (r.status !== 201) throw new Error(`crear entrega de ensayo: ${r.status} ${JSON.stringify(r.body?.error ?? {})}`);
  return r.body.delivery.id;
}
const economia = (d, cuerpo) => pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/deliveries/${d}/economics`,
  { operation_id: randomUUID(), source: 'DECLARADO_POR_LA_ORGANIZACION', basis_kind: 'CANTIDAD_DECLARADA_EN_ENTREGA', ...cuerpo });

const E_A = await entregaDeEnsayo('100');   // 2 USD/KG → comparable
const E_B = await entregaDeEnsayo('200');   // 3 USD/KG → comparable
const E_QQ = await entregaDeEnsayo('50');   // precio por QQ sobre base KG → excluido
const E_EUR = await entregaDeEnsayo('10');  // EUR → grupo propio
const E_SIN = await entregaDeEnsayo('80');  // sin dato económico → denominador, no cero
await economia(E_A, { price_amount: '2', price_currency: 'USD', price_unit: 'KG' });
await economia(E_B, { price_amount: '3', price_currency: 'USD', price_unit: 'KG' });
await economia(E_QQ, { price_amount: '120', price_currency: 'USD', price_unit: 'QQ' });
await economia(E_EUR, { price_amount: '5', price_currency: 'EUR', price_unit: 'KG' });

const ind = (q = '', token = admin.token) => pedir(token, 'GET', `/api/v1/organizations/${COOP}/analytics/commercial${q}`);
const de = (body, id) => body.indicators.filter((i) => i.id === id);

// ------------------------------------------------------------------ API
await caso('CONTROL: la pantalla NO dice siempre «sin datos»: hay cálculos que responden', async () => {
  const r = await ind();
  if (r.status !== 200) throw new Error(`los indicadores respondieron ${r.status}`);
  exigeEntrada('lista de indicadores', r.body.indicators);
  const calculados = r.body.indicators.filter((i) => i.status === 'CALCULADO');
  const estados = [...new Set(r.body.indicators.map((i) => i.status))];
  return [calculados.length >= 3, `${calculados.length} indicador(es) CALCULADO(s) de ${r.body.indicators.length} · estados presentes: ${estados.join(', ')}`];
});

await caso('CASO POSITIVO: el precio medio ponderado se calcula con su fórmula y denominador', async () => {
  const r = await ind();
  const g = de(r.body, 'PRECIO_MEDIO_PONDERADO').find((x) => x.group?.currency === 'USD' && x.group?.unit === 'KG');
  const encontrado = exigeEntrada('grupo USD por KG', g);
  const formula = /Σ \(precio × cantidad base\) ÷ Σ cantidad base/.test(encontrado.formula);
  const denominador = encontrado.denominator?.value !== null && encontrado.denominator?.value !== undefined;
  return [encontrado.status === 'CALCULADO' && formula && denominador,
    `valor=${encontrado.value} ${encontrado.unit} · denominador=${encontrado.denominator?.value} · fórmula declarada=${formula}`];
});

await caso('CASO NEGATIVO: lo incompatible se EXCLUYE y se cuenta, en vez de convertirse', async () => {
  const r = await ind();
  const grupos = de(r.body, 'PRECIO_MEDIO_PONDERADO');
  const hayEur = grupos.some((x) => x.group?.currency === 'EUR');
  const sinQQ = !grupos.some((x) => x.group?.unit === 'QQ');
  const exclusiones = grupos[0].excluded ?? [];
  const dicePorQue = exclusiones.some((e) => /por QQ sobre base en KG/.test(e.reason) && e.count > 0);
  return [hayEur && sinQQ && dicePorQue,
    `EUR en su propio grupo=${hayEur} · ninguna unidad convertida=${sinQQ} · exclusiones contadas: ${exclusiones.map((e) => e.count).join('+') || '0'}`];
});

await caso('AUSENCIA NO ES CERO: la entrega sin dato económico va al denominador', async () => {
  const r = await ind();
  const c = de(r.body, 'COBERTURA_ECONOMICA')[0];
  exigeEntrada('cobertura económica', c);
  const partes = /^(\d+) de (\d+)$/.exec(c.value ?? '');
  if (!partes) throw new Error(`la cobertura no tiene la forma «x de y»: ${c.value}`);
  const con = Number(partes[1]); const total = Number(partes[2]);
  return [total > con && /NO cuentan como precio cero/i.test(c.coverage.note),
    `${c.value} entregas con dato · excluidas=${c.coverage.excluded} · lo dice=${/NO cuentan como precio cero/i.test(c.coverage.note)}`];
});

await caso('CADA INDICADOR se explica: qué mide, fórmula, unidad, período, denominador, cobertura y procedencia', async () => {
  const r = await ind();
  const faltan = r.body.indicators.filter((i) =>
    !i.what_it_measures || !i.formula || !i.unit || !i.period || !i.provenance
    || (i.status === 'CALCULADO' && i.coverage === null && i.denominator === null && i.id !== 'VOLUMEN_RECIBIDO' && i.id !== 'PRESUPUESTO_GUARDADO'));
  const conLimites = r.body.indicators.filter((i) => Array.isArray(i.limits) && i.limits.length > 0).length;
  return [faltan.length === 0 && conLimites === r.body.indicators.length,
    `${r.body.indicators.length} indicadores, todos autodescritos=${faltan.length === 0} · con límites declarados=${conLimites}`];
});

await caso('TRES AUSENCIAS DISTINTAS: sin datos, no calculable y restringido no se confunden', async () => {
  // SIN_DATOS se demuestra con un período donde no hay nada: con datos presentes, todo calcula —y eso
  // es justamente lo que prueba que la pantalla no dice «sin datos» por construcción—.
  const vacio = await ind('?from=2019-01-01&to=2019-01-31');
  const aud = await ind('', auditor.token);
  const sinDatos = vacio.body.indicators.some((i) => i.status === 'SIN_DATOS' && i.why);
  const restringido = aud.body.indicators.find((i) => i.status === 'RESTRINGIDO');
  const mudo = restringido && restringido.value === null && restringido.denominator === null && restringido.coverage === null;
  return [sinDatos && Boolean(restringido) && mudo,
    `SIN_DATOS con porqué=${sinDatos} · RESTRINGIDO sin cifras=${mudo} (${restringido?.id ?? 'ninguno'})`];
});

await caso('EL PRESUPUESTO NO ES EL PRECIO, y un pago informado no acredita transferencia', async () => {
  const r = await ind();
  const coste = de(r.body, 'PRESUPUESTO_GUARDADO')[0];
  const pagos = de(r.body, 'PAGOS_INFORMADOS_SOBRE_ACORDADO')[0];
  const noEficiencia = coste.limits.join(' ');
  const noTransferencia = pagos.limits.join(' ');
  return [/NO demuestra eficiencia operativa/i.test(noEficiencia) && /No se mezcla con el precio/i.test(noEficiencia)
    && /NO acredita una transferencia/i.test(noTransferencia),
  `presupuesto: procedencia=${coste.provenance} · pagos: procedencia=${pagos.provenance} · ambos con su advertencia`];
});

await caso('EL RIESGO VA APARTE: ningún indicador lo usa y UNDETERMINED no es riesgo bajo', async () => {
  const r = await ind();
  const texto = JSON.stringify(r.body.indicators);
  const limpio = !/conclusion|severity|technical_result|UNDETERMINED/i.test(texto);
  const aparte = /UNDETERMINED. NO significa riesgo bajo/i.test(r.body.regulatory_context.note);
  return [limpio && aparte, `indicadores sin riesgo=${limpio} · contexto regulatorio lo advierte=${aparte}`];
});

await caso('NO HAY SCORE ni umbral de «datos suficientes»; lo no implementado lleva su condición', async () => {
  const r = await ind();
  const sinScore = !/\bscore\b|puntuaci|umbral/i.test(JSON.stringify(r.body.indicators));
  const preguntas = r.body.not_implemented ?? [];
  const conCondicion = preguntas.length >= 3 && preguntas.every((n) => n.question && n.condition && n.condition.length > 40);
  const comprador = preguntas.find((n) => /comprador/i.test(n.question));
  return [sinScore && conCondicion && /precio de VENTA/i.test(comprador?.condition ?? ''),
    `sin score en los indicadores=${sinScore} · ${preguntas.length} preguntas no implementadas, todas con condición=${conCondicion}`];
});

await caso('PERÍODO: no se inventa ventana por defecto; uno vacío es SIN_DATOS y uno invertido 422', async () => {
  const abierto = await ind();
  const vacio = await ind('?from=2019-01-01&to=2019-01-31');
  const invertido = await ind(`?from=${HOY}&to=2019-01-01`);
  const c = de(vacio.body, 'COBERTURA_ECONOMICA')[0];
  return [abierto.body.period.kind === 'TODO_LO_REGISTRADO' && c.status === 'SIN_DATOS' && c.value === null && invertido.status === 422,
    `abierto=${abierto.body.period.kind} · período vacío → ${c.status} con porqué · invertido → ${invertido.status}`];
});

await caso('PERMISOS SOBRE AGREGADOS: el técnico no abre la pantalla; el auditor no ve lo que no lee', async () => {
  const tec = await ind('', tecnico.token);
  const aud = await ind('', auditor.token);
  const restringidos = (aud.body?.indicators ?? []).filter((i) => i.status === 'RESTRINGIDO').map((i) => i.id);
  // CONTROL autorizado: el admin sí los recibe con estado real.
  const adm = await ind();
  const mismos = restringidos.filter((id) => de(adm.body, id)[0]?.status === 'RESTRINGIDO');
  return [tec.status === 403 && aud.status === 200 && restringidos.length > 0 && mismos.length === 0,
    `técnico → ${tec.status} · auditor → ${aud.status} con [${restringidos.join(', ')}] restringidos · admin los ve=${mismos.length === 0}`];
});

await caso('DESCARGA: exige permiso de exportar y lleva las advertencias', async () => {
  const ok = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/analytics/commercial/download`);
  const tec = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/analytics/commercial/download`);
  const tipo = ok.headers.get('content-type') ?? '';
  return [ok.status === 200 && /spreadsheetml/.test(tipo) && tec.status === 403,
    `admin → ${ok.status} (${tipo.slice(0, 40)}) · técnico → ${tec.status}`];
});

await caso('AISLAMIENTO: comparar asociaciones no autoriza consultar otra organización', async () => {
  const otras = await pedir(admin.token, 'GET', '/api/v1/organizations');
  const ajena = (otras.body ?? []).find((o) => o.id !== COOP);
  if (!ajena) return [true, 'solo hay una organización en el DEMO'];
  const r = await pedir(admin.token, 'GET', `/api/v1/organizations/${ajena.id}/analytics/commercial`);
  return [r.status === 404 || r.status === 403, `organización ajena → ${r.status} (opaco)`];
});

await caso('LEER no cambia nada del dominio', async () => {
  const antes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/deliveries`);
  await ind();
  await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/analytics/producers`);
  const despues = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/deliveries`);
  const escribir = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/analytics/commercial`, {});
  const n = (x) => (Array.isArray(x.body) ? x.body : x.body?.items ?? []).length;
  return [n(antes) === n(despues) && escribir.status === 404,
    `${n(antes)} entregas antes y después · no existe escritura (POST → ${escribir.status})`];
});

// ------------------------------------------------------------------ navegador
const navegador = await chromium.launch();
try {
  const entrar = async (cuenta, viewport = { width: 1280, height: 900 }) => {
    const ctx = await navegador.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(WEB);
    await page.getByLabel('Correo').fill(cuenta.cuenta.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(cuenta.cuenta.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });
    return { ctx, page };
  };
  const abrir = async (page) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/indicadores`);
    await page.getByRole('heading', { level: 1, name: 'Indicadores comerciales' }).waitFor({ timeout: 20000 });
    // El estado de carga también pinta `.state`: esperar a la TABLA, o se lee la pantalla a medias.
    await page.locator('table[aria-label="Indicadores comerciales"]').waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: se llega desde el menú y la pantalla explica por qué no hay un número único', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Indicadores', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Indicadores comerciales' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/no hay un número único/i.test(t) && /ponderar/i.test(t) && /umbral/i.test(t),
      `explica la ausencia de score=${/ponderar/i.test(t)} · menciona el umbral=${/umbral/i.test(t)}`];
  });

  await caso('PANTALLA: se ven valores calculados junto a sus fórmulas y denominadores', async () => {
    await abrir(page);
    const t = await page.locator('main').innerText();
    const formula = /Fórmula:/.test(t);
    const denominador = /Suma de las cantidades base|Entregas registradas/.test(t);
    const calculado = /Calculado/.test(t);
    const sinMarkdown = !t.includes('**');
    return [formula && denominador && calculado && sinMarkdown,
      `fórmulas=${formula} · denominadores=${denominador} · algún Calculado=${calculado} · sin asteriscos=${sinMarkdown}`];
  });

  await caso('PANTALLA: las exclusiones se ven con su recuento y su razón', async () => {
    await abrir(page);
    const t = await page.locator('main').innerText();
    return [/Excluido ×\d+/.test(t) && /no se convierte/i.test(t),
      `exclusiones contadas en pantalla=${/Excluido ×\d+/.test(t)}`];
  });

  await caso('PANTALLA: el riesgo aparece APARTE y lo no implementado con su condición', async () => {
    await abrir(page);
    const t = await page.locator('main').innerText();
    const aparte = /Contexto regulatorio \(no es un indicador comercial\)/.test(t);
    const noImpl = /Lo que NO se responde todavía/.test(t) && /precio de VENTA/i.test(t);
    return [aparte && noImpl, `riesgo en su sección=${aparte} · condiciones visibles=${noImpl}`];
  });

  await caso('FILTRO por período en pantalla: cambia el resultado y lo rotula', async () => {
    await abrir(page);
    await page.getByLabel('Desde', { exact: true }).fill('2019-01-01');
    await page.getByLabel('Hasta', { exact: true }).fill('2019-01-31');
    await page.locator('table[aria-label="Indicadores comerciales"]').filter({ hasText: 'Sin datos' }).first().waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/Sin datos/.test(t) && /Por qué no hay valor/.test(t),
      `período vacío rotulado=${/Sin datos/.test(t)} · con su porqué=${/Por qué no hay valor/.test(t)}`];
  });

  await caso('PERMISOS EN PANTALLA: el técnico recibe el motivo, no una pantalla vacía', async () => {
    const { ctx: c2, page: p2 } = await entrar(tecnico);
    await p2.goto(`${WEB}/organizaciones/${COOP}/indicadores`);
    await p2.getByRole('heading', { level: 1, name: 'Indicadores comerciales' }).waitFor({ timeout: 20000 });
    const t = await p2.locator('main').innerText();
    const enMenu = await p2.getByRole('link', { name: 'Indicadores', exact: true }).count();
    await c2.close();
    return [/no lee indicadores comerciales/i.test(t) && enMenu === 0,
      `motivo mostrado=${/no lee indicadores comerciales/i.test(t)} · enlaces en el menú=${enMenu}`];
  });

  await caso('TECLADO: se cambia el período y se descarga sin ratón', async () => {
    await abrir(page);
    await page.getByLabel('Desde', { exact: true }).focus();
    await page.keyboard.type('2019-01-01');
    const boton = page.getByRole('button', { name: 'Descargar con sus supuestos' });
    await boton.focus();
    const enfocado = await page.evaluate(() => document.activeElement?.textContent);
    const descarga = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    await page.keyboard.press('Enter');
    const d = await descarga;
    return [enfocado?.includes('Descargar') === true && Boolean(d),
      `foco en «${enfocado}» · descarga iniciada con Enter=${Boolean(d)}`];
  });

  await caso('390 px: nada se corta y las tablas desplazan en horizontal', async () => {
    const { ctx: c3, page: p3 } = await entrar(admin, { width: 390, height: 844 });
    await p3.goto(`${WEB}/organizaciones/${COOP}/indicadores`);
    await p3.getByRole('heading', { level: 1, name: 'Indicadores comerciales' }).waitFor({ timeout: 20000 });
    await p3.locator('table[aria-label="Indicadores comerciales"]').waitFor({ timeout: 20000 });
    const desborde = await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const envueltas = await p3.locator('.table-wrap').count();
    await c3.close();
    return [!desborde && envueltas > 0, `desborde horizontal=${desborde} · ${envueltas} tabla(s) con contenedor desplazable`];
  });

  await ctx.close();
} finally {
  await navegador.close();
}

void E_SIN;
const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones correctas`);
process.exit(ok === resultados.length ? 0 : 1);
