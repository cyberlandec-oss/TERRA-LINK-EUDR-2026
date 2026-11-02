// P1-011 — Histórico temporal y alertas: recorrido completo en navegador real y por API (RF-42).
//
//   node e2e/review/historico.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **reutiliza lo que ya existe**: el registro de cambios de la ficha entra en la línea, no se duplica,
//      y la ruta original `plots/:id/history` sigue respondiendo lo suyo;
//   2. **el pasado no se reescribe**: leer dos veces da lo mismo y una lectura no cambia el dominio;
//   3. **las tres fechas separadas**, y la que falta se declara —no se sustituye por otra—;
//   4. **un año sin registros se rotula**, no se rellena con ceros ni se omite;
//   5. **comparar enseña sus limitaciones**: un cambio de método o de cobertura impide leer una
//      diferencia como mejora;
//   6. **alertas con causa trazable**, de solo lectura, y con su **acción** alcanzable;
//   7. permisos y alcance, enlaces, estados de pantalla, teclado y 390 px.
//
// NO cambia ningún dato: todo el histórico es de lectura y esta revisión no escribe nada.
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

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
  return { status: r.status, body };
};

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');

const parcelas = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots`);
const lista = Array.isArray(parcelas.body) ? parcelas.body : parcelas.body?.items ?? [];
if (lista.length === 0) throw new Error('la cooperativa demo no tiene parcelas');

// Se elige la parcela con más versiones de geometría: es la que permite comparar de verdad.
let elegida = null;
for (const p of lista) {
  const t = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${p.id}/timeline`);
  if (t.status !== 200) continue;
  const n = (t.body?.comparable ?? []).length;
  if (!elegida || n > elegida.versiones) elegida = { plot: p, versiones: n, hist: t.body };
}
const parcela = exigeEntrada('parcela con histórico', elegida?.plot);
const hist = exigeEntrada('histórico de la parcela', elegida?.hist);

// ------------------------------------------------------------------ API
await caso('CONTROL: el histórico responde y declara su alcance', async () => {
  exigeEntrada('períodos', hist.periods);
  return [hist.plot.code === parcela.plot_code && typeof hist.scope === 'string',
    `${hist.plot.code} · alcance=${hist.scope} · ${hist.periods.length} período(s) · ${elegida.versiones} versión(es)`];
});

await caso('REUTILIZA el registro de cambios existente, y no lo duplica', async () => {
  const cambios = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${parcela.id}/history`);
  if (cambios.status !== 200) throw new Error(`el registro de cambios respondió ${cambios.status}`);
  exigeEntrada('filas del registro de cambios', cambios.body);
  const enLinea = hist.periods.flatMap((p) => p.entries).filter((e) => e.kind === 'CAMBIO_DE_FICHA');
  const mismos = enLinea.length === cambios.body.length;
  // La ruta original sigue siendo la suya: la línea temporal NO la ensombrece.
  const esRegistro = Array.isArray(cambios.body) && cambios.body.every((c) => 'change_type' in c && 'version' in c);
  return [mismos && esRegistro && hist.change_log_href.endsWith('/history'),
    `${enLinea.length} cambios en la línea = ${cambios.body.length} del registro · ruta original intacta=${esRegistro}`];
});

await caso('TRES FECHAS separadas, y la ausente se declara en vez de sustituirse', async () => {
  const todas = hist.periods.flatMap((p) => p.entries);
  exigeEntrada('entradas del histórico', todas[0]);
  const claves = todas.every((e) => 'occurred_at' in e && 'recorded_at' in e && 'evaluated_at' in e);
  const sinFecha = todas.filter((e) => e.occurred_at === null);
  const declarada = sinFecha.every((e) => /no registra esta fecha|Sin fecha de|no tiene «fecha del hecho»/i.test(e.dates_note));
  // Y ninguna entrada sin fecha del hecho la copia de la de registro.
  const noSustituye = sinFecha.every((e) => e.occurred_at !== e.recorded_at);
  return [claves && declarada && noSustituye,
    `${todas.length} entradas · ${sinFecha.length} sin fecha del hecho, todas declaradas=${declarada} · sin sustitución=${noSustituye}`];
});

await caso('AÑOS: consecutivos, y los vacíos rotulados en vez de omitidos', async () => {
  // Los años son consecutivos: ninguno desaparece en silencio.
  const anios = hist.periods.map((p) => p.year);
  if (anios.length === 0) throw new Error('la parcela elegida no tiene ningún período');
  const consecutivos = anios.every((y, i) => i === 0 || y === anios[i - 1] + 1);
  const vacios = hist.periods.filter((p) => p.status === 'SIN_REGISTROS');
  if (vacios.length === 0) {
    // NO se da por demostrado lo que este conjunto de datos no puede mostrar: todo el DEMO es del mismo año.
    return [consecutivos,
      `${anios.length} año(s) consecutivos=${consecutivos} · el DEMO no tiene ningún año vacío: `
      + 'el rótulo SIN_REGISTROS lo demuestra history.int-spec.ts, no esta revisión'];
  }
  const bienDichos = vacios.every((p) => p.entries.length === 0 && /no hay nada registrado/i.test(p.note));
  return [bienDichos && consecutivos,
    `${vacios.length} año(s) sin registros, rotulados=${bienDichos} · años consecutivos=${consecutivos}`];
});

await caso('EL PASADO NO SE REESCRIBE: dos lecturas idénticas, sin duplicación', async () => {
  const a = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${parcela.id}/timeline`);
  const b = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${parcela.id}/timeline`);
  if (a.status !== 200 || b.status !== 200) throw new Error(`lecturas ${a.status}/${b.status}`);
  const ids = a.body.periods.flatMap((p) => p.entries).map((e) => e.id);
  const sinRepetir = new Set(ids).size === ids.length;
  return [JSON.stringify(a.body.periods) === JSON.stringify(b.body.periods) && sinRepetir,
    `${ids.length} entradas, sin repetidas=${sinRepetir} · dos lecturas iguales`];
});

await caso('COMPARAR enseña las limitaciones, y no presenta un cambio como mejora', async () => {
  if (elegida.versiones < 2) return [true, 'esta parcela tiene una sola versión: el producto lo dice y no inventa una comparación'];
  const [v1, v2] = hist.comparable;
  const c = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${parcela.id}/timeline/compare?from=${v1.id}&to=${v2.id}`);
  if (c.status !== 200) throw new Error(`comparar respondió ${c.status}`);
  exigeEntrada('limitaciones declaradas', c.body.limitations);
  const sinJuicio = !/mejor|peor|mejora|deterioro/i.test(JSON.stringify(c.body.changed));
  const coherente = c.body.comparable === (c.body.limitations.length === 0);
  // CONTROL: comparar una versión consigo misma se rechaza, no devuelve «sin cambios».
  const misma = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${parcela.id}/timeline/compare?from=${v1.id}&to=${v1.id}`);
  return [sinJuicio && coherente && misma.status === 422,
    `${c.body.limitations.length} limitación(es) · comparable=${c.body.comparable} · misma versión → ${misma.status}`];
});

await caso('ALERTAS: cada una con su causa trazable y lo que NO significa', async () => {
  const a = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/temporal-alerts`);
  if (a.status !== 200) throw new Error(`las alertas respondieron ${a.status}`);
  exigeEntrada('respuesta de alertas', a.body.alerts);
  // S4 §20: la alerta lleva Problema → Impacto → Causa → Acción, y abre la acción.
  const completas = a.body.alerts.every((x) => x.label && x.impact && x.cause?.kind && x.cause?.id && x.cause?.what && x.action_href && x.action);
  const conCausa = completas && a.body.alerts.every((x) => x.what_it_does_not_mean);
  // Sin umbrales inventados: ninguna alerta habla de porcentajes, días ni plazos legales.
  const sinUmbral = !/\b\d+\s*(%|días|dias|meses)\b/i.test(JSON.stringify(a.body.alerts));
  return [conCausa && sinUmbral,
    `${a.body.alerts.length} alerta(s) sobre ${a.body.plots_considered} parcela(s) · problema+impacto+causa+acción=${completas} · sin umbrales=${sinUmbral}`];
});

await caso('ALERTAS de SOLO LECTURA: no hay forma de marcarlas ni resolverlas', async () => {
  const intentos = await Promise.all([
    pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/temporal-alerts`, { code: 'X' }),
    pedir(admin.token, 'PATCH', `/api/v1/organizations/${COOP}/temporal-alerts`, { resolved: true }),
    pedir(admin.token, 'DELETE', `/api/v1/organizations/${COOP}/temporal-alerts`),
  ]);
  const antes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/temporal-alerts`);
  const rechazados = intentos.every((r) => r.status === 404 || r.status === 405);
  return [rechazados && antes.status === 200,
    `escrituras rechazadas: ${intentos.map((r) => r.status).join('/')} · lectura sigue en ${antes.status}`];
});

await caso('ALCANCE Y PERMISOS: el técnico ve lo suyo; lo ajeno es 404', async () => {
  const mias = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/temporal-alerts`);
  if (mias.status !== 200) throw new Error(`alertas del técnico: ${mias.status}`);
  const suyas = new Set(mias.body.alerts.map((x) => x.plot_id));
  const propias = [];
  for (const p of lista) {
    const r = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/plots/${p.id}/timeline`);
    if (r.status === 200) propias.push(p.id); else if (r.status !== 404) throw new Error(`estado inesperado ${r.status}`);
  }
  const ajenas = lista.length - propias.length;
  const coherente = [...suyas].every((id) => propias.includes(id));
  // CONTROL autorizado: el admin sí abre una de las que el técnico no ve.
  const ajena = lista.find((p) => !propias.includes(p.id));
  const control = ajena ? await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/plots/${ajena.id}/timeline`) : { status: 200 };
  return [ajenas > 0 && coherente && control.status === 200,
    `técnico: ${propias.length} propias / ${ajenas} ajenas en 404 · alertas dentro de su alcance=${coherente} · control admin=${control.status}`];
});

await caso('SECCIONES RESTRINGIDAS: lo que el rol no lee se declara ausente, no vacío', async () => {
  const propia = await (async () => {
    for (const p of lista) {
      const r = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/plots/${p.id}/timeline`);
      if (r.status === 200) return r.body;
    }
    return null;
  })();
  exigeEntrada('histórico visible para el técnico', propia);
  const secciones = propia.restricted_sections.map((s) => s.section);
  const sinRiesgo = !propia.periods.flatMap((p) => p.entries).some((e) => e.kind === 'RIESGO');
  // CONTROL: el admin no recibe esa restricción.
  const sinRestriccion = !hist.restricted_sections.map((s) => s.section).includes('RIESGO');
  return [secciones.includes('RIESGO') && sinRiesgo && sinRestriccion,
    `técnico: [${secciones.join(', ')}] declaradas · sin entradas de riesgo=${sinRiesgo} · admin sin esa restricción=${sinRestriccion}`];
});

await caso('OTRA ORGANIZACIÓN: el histórico de una parcela ajena no se filtra', async () => {
  const otras = await pedir(admin.token, 'GET', '/api/v1/organizations');
  const ajena = (otras.body ?? []).find((o) => o.id !== COOP);
  const r = await pedir(admin.token, 'GET', `/api/v1/organizations/${ajena ? ajena.id : COOP}/plots/${parcela.id}/timeline`);
  const alertas = await pedir(admin.token, 'GET', `/api/v1/organizations/${ajena ? ajena.id : COOP}/temporal-alerts`);
  return [!ajena || (r.status === 404 && (alertas.status === 403 || alertas.status === 404)),
    ajena ? `parcela ajena → ${r.status} · alertas de otra organización → ${alertas.status}` : 'solo hay una organización'];
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
    await page.goto(`${WEB}/organizaciones/${COOP}/historico`);
    await page.getByRole('heading', { level: 1, name: 'Histórico y alertas' }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Alertas', exact: true }).waitFor({ timeout: 20000 });
    // El encabezado aparece antes que los datos: se espera a la tabla (o al vacío declarado) para no
    // leer la pantalla a medias y confundir «aún cargando» con «no hay».
    await page.locator('table[aria-label="Alertas del histórico"], .state').first().waitFor({ timeout: 20000 });
    await page.getByLabel('Parcela', { exact: true }).waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: se llega desde el menú y la pantalla avisa de que leer no cambia nada', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Histórico', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Histórico y alertas' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/no se marcan, no se resuelven/i.test(t) && /Ningún umbral de riesgo, caducidad o plazo legal se inventa/i.test(t),
      `aviso de solo lectura presente=${/no se marcan, no se resuelven/i.test(t)}`];
  });

  await caso('PANTALLA: línea por años, con los años sin registros rotulados', async () => {
    await abrir(page);
    await page.getByLabel('Parcela', { exact: true }).selectOption(parcela.id);
    await page.getByRole('heading', { name: `Evolución de ${parcela.plot_code}` }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    const fechas = /Ocurrió/.test(t) && /Se registró/.test(t) && /Se evaluó/.test(t);
    const sinRegistros = hist.periods.some((p) => p.status === 'SIN_REGISTROS');
    const rotulado = !sinRegistros || /Sin registros/.test(t);
    const noRegistrada = /no registrada/.test(t);
    return [fechas && rotulado && noRegistrada,
      `tres columnas de fecha=${fechas} · años vacíos rotulados=${rotulado} · fechas ausentes dichas=${noRegistrada}`];
  });

  await caso('RECORRIDO: de una alerta a su acción, sin resolver nada por el camino', async () => {
    await abrir(page);
    const enAPI = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/temporal-alerts`);
    const conAccion = enAPI.body.alerts.filter((x) => x.action_href).length;
    const enlace = page.locator('table[aria-label="Alertas del histórico"] a').first();
    if (await enlace.count() === 0) return [false, `la API da ${conAccion} alerta(s) con acción y la pantalla no muestra ninguna`];
    const texto = await enlace.innerText();
    await enlace.click();
    await page.waitForLoadState('networkidle');
    const destino = page.url();
    const vuelta = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/temporal-alerts`);
    const sigue = vuelta.status === 200;
    return [/\/parcelas\/|\/evidencias/.test(destino) && sigue,
      `«${texto}» → ${destino.replace(WEB, '')} · la alerta sigue ahí tras abrirla=${sigue}`];
  });

  await caso('COMPARAR en pantalla: las limitaciones se leen antes que el resultado', async () => {
    if (elegida.versiones < 2) return [true, 'una sola versión: la pantalla lo dice y no ofrece comparar'];
    await abrir(page);
    await page.getByLabel('Parcela', { exact: true }).selectOption(parcela.id);
    await page.getByRole('heading', { name: 'Comparar dos versiones' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Desde', { exact: true }).selectOption(hist.comparable[0].id);
    await page.getByLabel('Hasta', { exact: true }).selectOption(hist.comparable[1].id);
    await page.getByRole('heading', { name: /Limitaciones/ }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    const orden = t.indexOf('Limitaciones') < t.indexOf('Dataset del análisis');
    // La única mención permitida a «mejora» es la advertencia de que NO se interpreta como tal.
    const cuerpo = (t.split('Limitaciones')[1] ?? '').replace(/[^.]*no se interpreta como mejora ni como deterioro[^.]*\./gi, '');
    const sinJuicio = !/\bmejora\b|\bdeterioro\b|\bmejor\b|\bpeor\b/i.test(cuerpo);
    const advertencia = /no se interpreta como mejora ni como deterioro|NO CONCLUYENTE|NO es por sí sola una conclusión/i.test(t);
    return [orden && sinJuicio && advertencia,
      `limitaciones antes del detalle=${orden} · advertencia presente=${advertencia} · sin juicio fuera de ella=${sinJuicio}`];
  });

  await caso('TECLADO: la parcela se elige y la alerta se abre sin ratón', async () => {
    await abrir(page);
    await page.getByLabel('Parcela', { exact: true }).focus();
    await page.getByLabel('Parcela', { exact: true }).selectOption(parcela.id);
    await page.getByRole('heading', { name: `Evolución de ${parcela.plot_code}` }).waitFor({ timeout: 20000 });
    const enlace = page.locator('table[aria-label="Alertas del histórico"] a').first();
    if (await enlace.count() === 0) return [true, 'sin alertas con acción: nada que abrir por teclado'];
    await enlace.focus();
    const enfocado = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    return [enfocado === 'A' && /\/parcelas\/|\/evidencias/.test(page.url()),
      `foco en ${enfocado} · Enter llevó a ${page.url().replace(WEB, '')}`];
  });

  await caso('390 px: nada se corta y las tablas desplazan en horizontal', async () => {
    const { ctx: c2, page: p2 } = await entrar(admin, { width: 390, height: 844 });
    await p2.goto(`${WEB}/organizaciones/${COOP}/historico`);
    await p2.getByRole('heading', { level: 1, name: 'Histórico y alertas' }).waitFor({ timeout: 20000 });
    await p2.getByLabel('Parcela', { exact: true }).selectOption(parcela.id);
    await p2.getByRole('heading', { name: `Evolución de ${parcela.plot_code}` }).waitFor({ timeout: 20000 });
    const desborde = await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const envueltas = await p2.locator('.table-wrap').count();
    await c2.close();
    return [!desborde && envueltas > 0, `desborde horizontal=${desborde} · ${envueltas} tabla(s) con contenedor desplazable`];
  });

  await caso('PERMISOS EN PANTALLA: quien no lee parcelas no recibe una pantalla vacía, sino el motivo', async () => {
    const compras = await sesion('compras.cooperativa').catch(() => null);
    if (!compras) return [true, 'no hay una cuenta sin lectura de parcelas en el conjunto demo'];
    const { ctx: c3, page: p3 } = await entrar(compras);
    await p3.goto(`${WEB}/organizaciones/${COOP}/historico`);
    await p3.getByRole('heading', { level: 1, name: 'Histórico y alertas' }).waitFor({ timeout: 20000 });
    const t = await p3.locator('main').innerText();
    const enMenu = await p3.getByRole('link', { name: 'Histórico', exact: true }).count();
    await c3.close();
    const sinLectura = /no lee parcelas/i.test(t);
    return [sinLectura ? enMenu === 0 : /Alertas/.test(t),
      sinLectura ? `motivo mostrado y fuera del menú (${enMenu} enlaces)` : 'esta cuenta sí lee parcelas: ve la pantalla completa'];
  });

  await ctx.close();
} finally {
  await navegador.close();
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones correctas`);
process.exit(ok === resultados.length ? 0 : 1);
