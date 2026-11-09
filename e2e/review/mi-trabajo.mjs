// P1-003 — «Mi trabajo» ampliado: recorrido completo en navegador real y por API (RF-34; docs/14 §My Work;
// UX_UI §11; QA-11/QA-14).
//
//   node e2e/review/mi-trabajo.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **dos colas separadas**, personal y supervisión, y que la separación la decide la **autorización**;
//   2. **filtros reales**: los aplica el backend, y **no amplían** el alcance de nadie;
//   3. la **fila completa** que pide docs/14, con una **prioridad explicable** y sin plazos inventados;
//   4. los filtros **viven en la URL**: abrir una tarea y volver conserva la vista;
//   5. **estados vacíos** distintos, **teclado** y **390 px**;
//   6. que desde aquí **no se completa nada**: Mi trabajo es solo lectura;
//   7. y que la fila sale **porque el dominio la resuelve**, recorriendo la acción de verdad.
//
// CAMBIA DATOS DEMO en un punto, y solo en ese: el caso 7 captura la ubicación de una parcela pendiente, con
// una posición SIMULADA por el navegador de la prueba. Se guarda una versión de geometría real, como la
// guardaría una persona. El resto de los casos solo lee.
// Las cuentas DEMO se leen con la utilidad segura; nunca se imprimen credenciales.
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
const pedir = async (token, metodo, path) => {
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { authorization: `Bearer ${token}` } });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { /* no JSON */ }
  return { status: r.status, body, texto };
};
const cola = async (token, query = '') => {
  const r = await pedir(token, 'GET', `/api/v1/organizations/${COOP}/my-work${query}`);
  if (r.status !== 200) throw new Error(`la cola respondió ${r.status}, esperado 200`);
  exigeEntrada('filas de la cola', r.body?.rows);
  exigeEntrada('recuentos de las colas', r.body?.queues);
  return r.body;
};

const tecnico = await sesion('tecnico1.cooperativa');   // alcance: solo sus productores asignados
const admin = await sesion('admin.cooperativa');        // alcance: toda la organización

// ------------------------------------------------------------------ API
await caso('CONTROL: ambas cuentas reciben su cola, así que un 0 significa «nada», no «no responde»', async () => {
  const t = await cola(tecnico.token);
  const a = await cola(admin.token);
  return [t.total > 0 && a.total > 0, `técnico=${t.total} filas · administración=${a.total} filas`];
});

await caso('DOS COLAS: la separación la decide la autorización, no una preferencia', async () => {
  const t = await cola(tecnico.token);
  const a = await cola(admin.token);
  // Quien solo alcanza lo asignado trabaja, pero no supervisa a nadie.
  const tecnicoSoloPersonal = t.queues.supervision === 0 && t.queues.mine === t.total && t.rows.every((r) => r.queue === 'MINE');
  // Quien alcanza toda la organización ve el trabajo del equipo, que no es su responsabilidad personal.
  const adminSoloSupervision = a.queues.mine === 0 && a.queues.supervision === a.total && a.rows.every((r) => r.queue === 'SUPERVISION');
  return [tecnicoSoloPersonal && adminSoloSupervision,
    `técnico personal=${t.queues.mine}/supervisión=${t.queues.supervision} · administración personal=${a.queues.mine}/supervisión=${a.queues.supervision}`];
});

await caso('FILA COMPLETA: trae lo que docs/14 exige, con su prioridad explicada', async () => {
  const t = await cola(tecnico.token);
  const campos = ['code', 'title', 'queue', 'entity', 'reason', 'impact', 'assignee_note', 'due_date', 'due_state', 'priority', 'priority_rule', 'status', 'action'];
  const faltan = campos.filter((c) => !(c in t.rows[0]));
  const explicadas = t.rows.every((r) => typeof r.priority_rule === 'string' && r.priority_rule.length > 20);
  return [faltan.length === 0 && explicadas, `campos ausentes=${faltan.length ? faltan.join(',') : 'ninguno'} · todas con motivo=${explicadas}`];
});

await caso('PLAZO: no se inventa donde el dominio no lo registra', async () => {
  const t = await cola(tecnico.token);
  const sinPlazo = t.rows.filter((r) => r.due_date === null);
  const honestas = sinPlazo.every((r) => r.due_state === 'NONE' && /no registra plazo/i.test(r.priority_rule));
  return [sinPlazo.length > 0 && honestas, `${sinPlazo.length} fila(s) sin plazo en el dominio, todas declarándolo=${honestas}`];
});

await caso('FILTROS: los aplica el BACKEND, y filtran de verdad', async () => {
  const todo = await cola(admin.token);
  const backend = todo.filters?.applied_in === 'BACKEND';
  const borradores = await cola(admin.token, '?status=DRAFT');
  const soloBorradores = borradores.total > 0 && borradores.total < todo.total && borradores.rows.every((r) => r.status === 'DRAFT');
  const parcelas = await cola(admin.token, '?status=ACTIVE');
  const soloParcelas = parcelas.total > 0 && parcelas.rows.every((r) => r.code === 'PLOTS_WITHOUT_LOCATION');
  return [backend && soloBorradores && soloParcelas,
    `declarado=${todo.filters?.applied_in} · DRAFT=${borradores.total}/${todo.total} · ACTIVE=${parcelas.total} todas parcelas=${soloParcelas}`];
});

await caso('FILTRO de cola: cada cuenta solo puede filtrar lo que de verdad tiene', async () => {
  const adminPersonal = await cola(admin.token, '?queue=MINE');
  const adminSupervision = await cola(admin.token, '?queue=SUPERVISION');
  const tecnicoSupervision = await cola(tecnico.token, '?queue=SUPERVISION');
  const tecnicoPersonal = await cola(tecnico.token, '?queue=MINE');
  return [adminPersonal.total === 0 && adminSupervision.total > 0 && tecnicoSupervision.total === 0 && tecnicoPersonal.total > 0,
    `administración MINE=${adminPersonal.total}/SUPERVISION=${adminSupervision.total} · técnico MINE=${tecnicoPersonal.total}/SUPERVISION=${tecnicoSupervision.total}`];
});

await caso('FILTRAR NO AMPLÍA EL ALCANCE: el técnico no alcanza lo ajeno ni pidiéndolo', async () => {
  const propio = await cola(tecnico.token, '?assignee=ME');
  // Una membresía que no es la suya: la respuesta es vacía, no la cola de otra persona.
  const ajena = await cola(tecnico.token, '?assignee=11111111-2222-3333-4444-555555555555');
  const suyas = propio.rows.every((r) => r.queue === 'MINE');
  return [propio.total > 0 && suyas && ajena.total === 0,
    `suyas=${propio.total} (todas personales=${suyas}) · pidiendo las de otra persona=${ajena.total}`];
});

await caso('UN FILTRO INVÁLIDO es un error, no un filtro que no filtra', async () => {
  const q = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/my-work?queue=TODAS`);
  const a = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/my-work?assignee=cualquiera`);
  return [q.status === 400 && a.status === 400, `cola inválida=${q.status} · responsable inválido=${a.status}`];
});

await caso('SOLO LECTURA: desde Mi trabajo no se completa nada', async () => {
  const post = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/my-work`);
  const patch = await pedir(admin.token, 'PATCH', `/api/v1/organizations/${COOP}/my-work`);
  return [post.status === 404 && patch.status === 404, `POST=${post.status} · PATCH=${patch.status}`];
});

// ------------------------------------------------------------------ NAVEGADOR
const navegador = await chromium.launch();
try {
  // Ubicación SIMULADA por el navegador de la prueba: hace falta para recorrer la captura de verdad y ver que
  // la fila sale de la cola. El servidor no se modifica; lo que se guarda es una versión de geometría real.
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-EC',
    geolocation: { latitude: -0.8479, longitude: -80.1601, accuracy: 8 }, permissions: ['geolocation'] });
  const page = await ctx.newPage();
  await page.goto(WEB);
  await page.getByLabel('Correo').fill(tecnico.cuenta.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(tecnico.cuenta.contrasena);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });

  const inicio = `${WEB}/organizaciones/${COOP}`;
  const abrir = async (query = '') => {
    await page.goto(`${inicio}${query}`);
    await page.getByRole('heading', { name: 'Mi trabajo' }).waitFor({ timeout: 20000 });
    // La carga termina en uno de tres desenlaces, y los tres son estados declarados de la pantalla.
    await page.locator('main')
      .getByText(/Cola personal|No tienes pendientes en esta organización|Ningún pendiente coincide con estos filtros/)
      .first().waitFor({ timeout: 20000 });
  };

  await caso('PANTALLA: el técnico ve su cola personal y la de supervisión, separadas', async () => {
    await abrir();
    const t = await page.locator('main').innerText();
    const personal = /Cola personal/.test(t);
    const supervision = /Supervisión/.test(t) && /No hay trabajo del equipo pendiente de supervisión/.test(t);
    const tabla = await page.getByRole('table', { name: 'Cola personal' }).isVisible();
    return [personal && supervision && tabla, `cola personal=${personal} con tabla=${tabla} · supervisión vacía y rotulada=${supervision}`];
  });

  await caso('PANTALLA: cada fila muestra prioridad con su motivo, responsable, plazo, estado y acción', async () => {
    const fila = page.getByRole('table', { name: 'Cola personal' }).locator('tbody tr').first();
    const t = await fila.innerText();
    const prioridad = /ALTA|MEDIA|BAJA/.test(t);
    const motivo = t.length > 80;
    const plazoHonesto = /Sin plazo en el dominio|Vencido|Próximo|Con plazo/.test(t);
    const accion = await fila.getByRole('link').count();
    return [prioridad && motivo && plazoHonesto && accion >= 2,
      `prioridad=${prioridad} · motivo visible=${motivo} · plazo declarado=${plazoHonesto} · enlaces de la fila=${accion}`];
  });

  await caso('FILTRO en pantalla: elegirlo cambia la lista Y la URL', async () => {
    await page.getByLabel('Estado').selectOption('DRAFT');
    await page.waitForFunction(() => window.location.search.includes('estado=DRAFT'), null, { timeout: 10000 });
    await page.getByRole('table', { name: 'Cola personal' }).waitFor({ timeout: 10000 });
    const filas = await page.getByRole('table', { name: 'Cola personal' }).locator('tbody tr').count();
    const t = await page.locator('main').innerText();
    return [page.url().includes('estado=DRAFT') && filas > 0 && !/Parcelas sin ubicación/.test(t),
      `url=${page.url().split('?')[1]} · filas=${filas} · ya no hay parcelas=${!/Parcelas sin ubicación/.test(t)}`];
  });

  await caso('VOLVER conserva los filtros: abrir la tarea y regresar devuelve la misma vista', async () => {
    const antes = page.url();
    await page.getByRole('table', { name: 'Cola personal' }).locator('tbody tr').first().getByRole('link').first().click();
    await page.waitForURL(/\/entregas\/|\/parcelas\//, { timeout: 20000 });
    const fuera = page.url();
    await page.goBack();
    await page.getByRole('heading', { name: 'Mi trabajo' }).waitFor({ timeout: 20000 });
    const seleccion = await page.getByLabel('Estado').inputValue();
    return [page.url() === antes && seleccion === 'DRAFT' && fuera !== antes,
      `salió a ${fuera.split('/').slice(-2).join('/')} · volvió con estado=${seleccion}`];
  });

  await caso('ESTADO VACÍO por filtro: lo dice, y no finge que no hay trabajo', async () => {
    await abrir('?estado=SUBMITTED');
    const t = await page.locator('main').innerText();
    const dice = /Ningún pendiente coincide con estos filtros/.test(t);
    const quitar = await page.getByRole('button', { name: 'Quitar filtros' }).isVisible();
    await page.getByRole('button', { name: 'Quitar filtros' }).click();
    await page.getByRole('table', { name: 'Cola personal' }).waitFor({ timeout: 10000 });
    return [dice && quitar && !page.url().includes('estado='), `mensaje propio=${dice} · se puede deshacer=${quitar}`];
  });

  await caso('TECLADO: se llega a los filtros y a una acción sin ratón', async () => {
    await abrir();
    let filtro = false;
    let accion = false;
    for (let i = 0; i < 60 && !(filtro && accion); i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id ?? '');
      const dentro = await page.evaluate(() => !!document.activeElement?.closest('table'));
      if (id === 'f-cola' || id === 'f-estado') filtro = true;
      if (filtro && dentro) accion = true;
    }
    return [filtro && accion, `foco en los filtros=${filtro} · foco en una fila=${accion}`];
  });

  // El criterio del que depende la historia: la fila sale porque el DOMINIO la resuelve, no porque aquí se
  // marque nada. Se recorre de verdad —capturar la ubicación de una parcela pendiente— y cambia datos DEMO.
  await caso('LA ACCIÓN RESUELVE EL DOMINIO: capturar la ubicación retira la fila de la cola', async () => {
    await abrir('?estado=ACTIVE');
    const tabla = page.getByRole('table', { name: 'Cola personal' });
    const antes = await tabla.locator('tbody tr').count();
    if (antes === 0) throw new Error('no quedan parcelas pendientes en DEMO: el caso no se ejecuta en falso');
    const codigo = await tabla.locator('tbody tr').first().locator('td').nth(2).innerText();
    await tabla.locator('tbody tr').first().getByRole('link', { name: 'Capturar ubicación' }).click();
    await page.getByRole('button', { name: 'Capturar ubicación' }).first().click();
    await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
    await page.getByRole('button', { name: 'Capturar otra ubicación' }).waitFor({ timeout: 20000 });
    await abrir('?estado=ACTIVE');
    const despues = await page.getByRole('table', { name: 'Cola personal' }).locator('tbody tr').count();
    const sigue = (await page.locator('main').innerText()).includes(codigo.trim());
    return [despues === antes - 1 && !sigue, `${codigo.trim()}: pendientes ${antes} → ${despues} · sigue listada=${sigue}`];
  });

  await caso('390 px: la cola se usa sin desbordamiento horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir();
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const visible = await page.getByRole('heading', { name: 'Mi trabajo' }).isVisible();
    return [!desborda && visible, `desborda=${desborda} · sección visible=${visible}`];
  });
} finally {
  await navegador.close();
}

const ok = resultados.every(Boolean);
console.log(`\nP1-003 Mi trabajo ampliado: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;
