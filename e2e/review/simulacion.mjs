// P1-009 — Simulador de preparación de lote: recorrido completo en navegador real y por API
// (RF-40; S3 §37).
//
//   node e2e/review/simulacion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **solo lectura**: no hay escritura, y nada del expediente cambia al simular;
//   2. **inputs y fecha visibles**, con las versiones que se usaron;
//   3. **el porcentaje no decide**: con causas abiertas sigue siendo NO EXPORTABLE;
//   4. **estado real**, **escenario** y **lo que seguiría bloqueado**, separados y rotulados;
//   5. suponerlo todo **no habilita** READY ni el despacho;
//   6. permisos, enlaces, estados de pantalla, teclado y 390 px.
//
// NO cambia ningún dato: la simulación es de lectura y esta revisión no escribe nada en ningún módulo.
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

const eudr = await sesion('eudr.cooperativa');        // lee expedientes
const tecnico = await sesion('tecnico1.cooperativa'); // no los lee

const lotes = await pedir(eudr.token, 'GET', `/api/v1/organizations/${COOP}/lots`);
const lote = exigeEntrada('lote de la cooperativa', (Array.isArray(lotes.body) ? lotes.body : lotes.body?.items ?? [])[0]);
const simular = async (token, assume = '') => {
  const r = await pedir(token, 'GET', `/api/v1/organizations/${COOP}/simulations/lots/${lote.id}${assume ? `?assume=${assume}` : ''}`);
  if (r.status !== 200) throw new Error(`la simulación respondió ${r.status}`);
  exigeEntrada('requisitos de la simulación', r.body?.real?.requirements);
  return r.body;
};

// ------------------------------------------------------------------ API
await caso('CONTROL: la simulación responde para el lote de la cooperativa', async () => {
  const s = await simular(eudr.token);
  return [s.real.requirements.length > 0 && s.read_only === true,
    `${lote.lot_code} · ${s.real.requirements.length} requisitos · solo lectura=${s.read_only}`];
});

await caso('SOLO LECTURA: no hay escritura y el expediente no cambia', async () => {
  // Se compara el LISTADO REAL de expedientes (`dd-cases`). Si la ruta no respondiera 200, el caso falla:
  // comparar dos cuerpos de error no demostraría nada.
  const expedientes = async () => {
    const r = await pedir(eudr.token, 'GET', `/api/v1/organizations/${COOP}/dd-cases`);
    if (r.status !== 200) throw new Error(`el listado de expedientes respondió ${r.status}`);
    exigeEntrada('listado de expedientes', r.body);
    return JSON.stringify(r.body);
  };
  const antes = await expedientes();
  const post = await pedir(eudr.token, 'POST', `/api/v1/organizations/${COOP}/simulations/lots/${lote.id}`, {});
  const patch = await pedir(eudr.token, 'PATCH', `/api/v1/organizations/${COOP}/simulations/lots/${lote.id}`, {});
  const conSupuestos = await simular(eudr.token, 'LEGAL_PROFILE');
  const despues = await expedientes();
  // Y el estado REAL que devuelve la simulación no se ve afectado por el supuesto.
  const sinSupuestos = await simular(eudr.token);
  const realIgual = JSON.stringify(conSupuestos.real.requirements) === JSON.stringify(sinSupuestos.real.requirements);
  return [post.status === 404 && patch.status === 404 && antes === despues && realIgual,
    `POST=${post.status} · PATCH=${patch.status} · expedientes sin cambios=${antes === despues} · estado real intacto=${realIgual}`];
});

await caso('INPUTS Y FECHA visibles, con las versiones usadas (RF-40)', async () => {
  const s = await simular(eudr.token);
  const reciente = Date.now() - Date.parse(s.simulated_at) < 120_000;
  const recuentos = s.inputs?.counts ?? {};
  const sinIdentidad = !/legal_name|first_name|coordinates|geometry/.test(JSON.stringify(recuentos));
  return [reciente && typeof recuentos.parcelas === 'number' && sinIdentidad && !!s.inputs.note,
    `fecha reciente=${reciente} · productores=${recuentos.productores} parcelas=${recuentos.parcelas} · solo recuentos=${sinIdentidad}`];
});

await caso('EL PORCENTAJE NO DECIDE: con causas abiertas, NO EXPORTABLE', async () => {
  const s = await simular(eudr.token);
  const pct = s.real.summary.percent_met;
  return [s.real.exportable === false && s.real.verdict === 'NO EXPORTABLE' && s.real.causes.length > 0
    && /cualquier requisito no cumplido bloquea/i.test(s.real.summary.note),
  `${pct} % cumplido y aun así ${s.real.verdict}, con ${s.real.causes.length} causa(s)`];
});

await caso('MISMAS REGLAS que el preflight, y lo no simulado se nombra', async () => {
  const s = await simular(eudr.token);
  const checks = s.real.dispatch_checks.map((c) => c.code).sort().join(',');
  const noSimulado = s.real.dispatch_not_simulated.map((c) => c.code).sort().join(',');
  return [checks === 'DD_PACKAGE,ORIGIN,QUALITY' && noSimulado === 'GATE,RESERVATION,STATUS',
    `comprobado=${checks} · declarado no simulado=${noSimulado}`];
});

await caso('TRES COSAS SEPARADAS: estado real, escenario y lo que seguiría bloqueado', async () => {
  const base = await simular(eudr.token);
  const primero = base.real.requirements.find((r) => r.status !== 'MET');
  if (!primero) throw new Error('no hay requisitos bloqueados: el caso no se ejecuta en falso');
  const s = await simular(eudr.token, primero.code);
  const realIntacto = s.real.requirements.find((r) => r.code === primero.code).status === primero.status;
  const supuesto = s.scenario.assumed.some((a) => a.code === primero.code && /SUPONER NO ES RESOLVER/.test(a.note));
  const fuera = !s.projected.still_blocked.some((b) => b.code === primero.code);
  return [realIntacto && supuesto && fuera,
    `real intacto=${realIntacto} · supuesto rotulado=${supuesto} · sale de «seguiría bloqueado»=${fuera}`];
});

await caso('SUPONERLO TODO no habilita nada: sigue NO EXPORTABLE', async () => {
  const base = await simular(eudr.token);
  const todos = base.real.requirements.filter((r) => r.status !== 'MET').map((r) => r.code).join(',');
  const s = await simular(eudr.token, todos);
  return [s.projected.still_blocked.length === 0 && s.projected.exportable === false && s.projected.causes.length > 0,
    `sin requisitos pendientes y aun así ${s.projected.verdict}: ${s.projected.causes[0]?.slice(0, 60)}…`];
});

await caso('CLASES distinguidas: dato, decisión y capacidad', async () => {
  const s = await simular(eudr.token);
  const clases = [...new Set(s.projected.still_blocked.map((b) => b.class))];
  const validas = clases.every((c) => ['DATO', 'DECISION', 'CAPACIDAD'].includes(c));
  const conMotivo = s.projected.still_blocked.every((b) => b.why && b.why.length > 20);
  return [clases.length > 0 && validas && conMotivo, `clases=${clases.join(', ')} · todas con motivo=${conMotivo}`];
});

await caso('PERMISOS: quien no lee expedientes no simula; otra organización 404', async () => {
  const sinPermiso = await pedir(tecnico.token, 'GET', `/api/v1/organizations/${COOP}/simulations/lots/${lote.id}`);
  const control = await pedir(eudr.token, 'GET', `/api/v1/organizations/${COOP}/simulations/lots/${lote.id}`);
  const ajena = await pedir(eudr.token, 'GET', `/api/v1/organizations/${COOP}/simulations/lots/00000000-0000-4000-8000-000000000000`);
  return [sinPermiso.status === 403 && control.status === 200 && ajena.status === 404,
    `técnico=${sinPermiso.status} · control=${control.status} · lote inexistente=${ajena.status}`];
});

// ------------------------------------------------------------------ NAVEGADOR
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
  const abrirYSimular = async (page) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/simulacion`);
    await page.getByRole('heading', { level: 1, name: 'Simulación de preparación' }).waitFor({ timeout: 20000 });
    await page.getByLabel('Lote', { exact: true }).selectOption(lote.id);
    await page.getByRole('heading', { name: 'Veredicto' }).waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(eudr);

  await caso('ENLACE: se llega desde el menú y la pantalla avisa de que no cambia nada', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Simulación', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: 'Simulación de preparación' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/no aprueba evidencias, no toca inventario/i.test(t) && /Suponer un requisito resuelto/i.test(t),
      `aviso de solo lectura presente=${/no aprueba evidencias/i.test(t)}`];
  });

  await caso('PANTALLA: veredicto, porcentaje con su advertencia, causas y entradas', async () => {
    await abrirYSimular(page);
    const t = await page.locator('main').innerText();
    const veredicto = /NO EXPORTABLE/.test(t);
    const advertencia = /cualquier requisito no cumplido bloquea/i.test(t);
    const causas = /Causas/.test(t);
    const entradas = /Qué se miró, y cuándo/.test(t) && /Reglas de riesgo/.test(t);
    return [veredicto && advertencia && causas && entradas,
      `veredicto=${veredicto} · advertencia del porcentaje=${advertencia} · causas=${causas} · entradas y fecha=${entradas}`];
  });

  await caso('RECORRIDO: marcar un supuesto cambia la proyección, NO el estado real', async () => {
    const antes = await page.getByRole('table', { name: 'Requisitos del expediente' }).innerText();
    const casilla = page.getByRole('checkbox').first();
    await casilla.check();
    await page.getByRole('heading', { name: 'Qué seguiría bloqueado' }).waitFor({ timeout: 20000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Simulando…'), null, { timeout: 20000 });
    const despues = await page.getByRole('table', { name: 'Requisitos del expediente' }).innerText();
    const t = await page.locator('main').innerText();
    const sigueNoExportable = /NO EXPORTABLE/.test(t);
    return [antes === despues && sigueNoExportable,
      `estado real intacto=${antes === despues} · sigue NO EXPORTABLE=${sigueNoExportable}`];
  });

  await caso('PANTALLA: las tres secciones están separadas y rotuladas', async () => {
    const t = await page.locator('main').innerText();
    const tres = /Estado real del expediente/.test(t) && /Escenario hipotético/.test(t) && /Qué seguiría bloqueado/.test(t);
    const clases = /Espera una decisión|Falta un dato|Capacidad no implementada/.test(t);
    return [tres && clases, `tres secciones=${tres} · clases visibles=${clases}`];
  });

  await caso('TECLADO y 390 px', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrirYSimular(page);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await abrirYSimular(page);
    let enCasilla = false;
    for (let i = 0; i < 80 && !enCasilla; i++) {
      await page.keyboard.press('Tab');
      enCasilla = await page.evaluate(() => document.activeElement?.getAttribute('type') === 'checkbox');
    }
    return [!desborda && enCasilla, `desborda=${desborda} · foco alcanza un supuesto=${enCasilla}`];
  });
  await ctx.close();

  const t = await entrar(tecnico);
  await caso('PANTALLA sin permiso: lo dice, y el menú no ofrece la entrada', async () => {
    const enMenu = await t.page.getByRole('link', { name: 'Simulación', exact: true }).count();
    await t.page.goto(`${WEB}/organizaciones/${COOP}/simulacion`);
    await t.page.getByRole('heading', { level: 1, name: 'Simulación de preparación' }).waitFor({ timeout: 20000 });
    const texto = await t.page.locator('main').innerText();
    const dice = /Tu rol no lee expedientes/.test(texto);
    const noFinge = !/no hay datos|sin registros/i.test(texto);
    return [enMenu === 0 && dice && noFinge, `entradas en el menú=${enMenu} · mensaje propio=${dice} · no lo disfraza=${noFinge}`];
  });
  await t.ctx.close();
} finally {
  await navegador.close();
}

const ok = resultados.every(Boolean);
console.log(`\nP1-009 simulador de preparación: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;
