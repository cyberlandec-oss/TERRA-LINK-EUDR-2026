// P1-001 / P1-002 — Recorrido COMPLETO de la audiencia externa, en navegador real y por API.
//
//   node e2e/review/portal-comprador.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. el destinatario **encuentra** sus recursos concedidos y **abre su vista**;
//   2. ve **solo** lo permitido: sin identidad de productores, sin geometrías, sin documentos personales;
//   3. **descarga** cuando tiene esa acción, y la descarga se identifica como **vista compartida interna**;
//   4. el **enlace y el QR** funcionan para él **sin membresía**, y lo llevan a su vista;
//   5. **se corta** al revocar;
//   6. una cuenta **sin concesión** no ve nada; **teclado** y **390 px**.
//
// Deja el entorno como lo encontró: revoca lo que concede.
import { randomUUID } from 'node:crypto';
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
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(64)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(64)} ${e.message}`);
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
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { /* no JSON */ }
  return { status: r.status, body, texto };
};

const admin = await sesion('admin.cooperativa');
const comprador = await sesion('comprador.importador');   // BUYER de OTRA organización
const auditorAjeno = await sesion('auditor.exportadora'); // tercera organización, sin concesión

const yo = await pedir(comprador.token, 'GET', '/api/v1/me');
const compradorId = exigeEntrada('id del comprador', yo.body?.id);
const lotes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/lots`);
const lote = exigeEntrada('lote de la cooperativa', (lotes.body?.items ?? lotes.body ?? [])[0]?.id);
const det = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/lots/${lote}`);
const referencia = exigeEntrada('referencia pública del lote', (det.body?.lot ?? det.body)?.public_reference);

// Estado de partida: sin concesión, el comprador no ve ni resuelve nada.
await caso('SIN CONCESIÓN: el rol BUYER por sí solo no abre nada', async () => {
  const lista = await pedir(comprador.token, 'GET', '/api/v1/granted');
  const sinEste = !(lista.body?.grants ?? []).some((g) => g.resource_type === 'LOT');
  const r = await pedir(comprador.token, 'GET', `/api/v1/public-references/${referencia}`);
  return [r.status === 404, `resolución=${r.status} · su lista ${sinEste ? 'no incluye este lote' : 'ya tenía concesiones'}`];
});

const concesion = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/access-grants`, {
  operation_id: randomUUID(), grantee_user_id: compradorId, resource_type: 'LOT', resource_id: lote,
  can_read: true, can_download: true, expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Revisión de despliegue P1-001',
});
const grant = exigeEntrada('concesión creada', concesion.body?.grant?.id);

await caso('CON CONCESIÓN: el enlace resuelve SIN membresía y se identifica como audiencia externa', async () => {
  const r = await pedir(comprador.token, 'GET', `/api/v1/public-references/${referencia}`);
  return [r.status === 200 && r.body.audience === 'GRANTEE' && r.body.grant_id === grant,
    `${r.status} · audiencia=${r.body?.audience}`];
});

await caso('CON CONCESIÓN: el QR también se le entrega', async () => {
  const r = await pedir(comprador.token, 'GET', `/api/v1/public-references/${referencia}/qr.svg`);
  return [r.status === 200 && r.texto.startsWith('<svg '), `${r.status} · ${r.texto.length} bytes`];
});

await caso('La vista NO trae identidad, geometrías ni documentos personales', async () => {
  const v = await pedir(comprador.token, 'GET', `/api/v1/granted/${grant}`);
  const t = JSON.stringify(v.body);
  const fugas = ['legal_name', 'first_name', 'document_number', 'geometry', 'coordinates', 'producer_code'].filter((k) => t.includes(k));
  const agregados = typeof v.body?.productores === 'number' && typeof v.body?.parcelas === 'number';
  return [v.status === 200 && fugas.length === 0 && agregados,
    `${v.status} · fugas=${fugas.length ? fugas.join(',') : 'ninguna'} · agregados presentes=${agregados}`];
});

await caso('AISLAMIENTO: una tercera organización sin concesión no resuelve ni ve', async () => {
  const r = await pedir(auditorAjeno.token, 'GET', `/api/v1/public-references/${referencia}`);
  const l = await pedir(auditorAjeno.token, 'GET', `/api/v1/granted/${grant}`);
  return [r.status === 404 && l.status === 404, `resolución=${r.status} · vista=${l.status}`];
});

// --------------------------------------------- PERÍODO DE PRODUCCIÓN (corrección del 2026-10-17)
// El contrato PROHÍBE deducir el período de producción de la fecha de entrega. Los datos DEMO dan los dos
// casos decisivos: un lote con cosecha DECLARADA por mes y otro con cosecha DESCONOCIDA y entrega con fecha.
{
  const todos = (lotes.body?.items ?? lotes.body ?? []);
  const idDe = (codigo) => exigeEntrada(`lote ${codigo}`, todos.find((l) => l.lot_code === codigo)?.id);
  const conConcesion = async (loteId, fn) => {
    const c = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/access-grants`, {
      operation_id: randomUUID(), grantee_user_id: compradorId, resource_type: 'LOT', resource_id: loteId,
      can_read: true, expires_at: new Date(Date.now() + 3600000).toISOString(), reason: 'Revisión del período',
    });
    const g = exigeEntrada('concesión del período', c.body?.grant?.id);
    try { return await fn(await pedir(comprador.token, 'GET', `/api/v1/granted/${g}`)); }
    finally { await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/access-grants/${g}/revoke`, { operation_id: randomUUID(), reason: 'Fin de la revisión del período' }); }
  };

  await caso('PERÍODO declarado: se publica 2026-09 con precisión de mes, NO los límites expandidos', () =>
    conConcesion(idDe('LOT-2026-00001'), (v) => {
      const pp = v.body?.production_period;
      if (!pp) return [false, 'la vista no trae production_period'];
      const t = JSON.stringify(pp);
      return [v.status === 200 && pp.precision === 'MONTH' && pp.start === '2026-09' && !t.includes('2026-09-01') && !t.includes('2026-10-13'),
        `precisión=${pp.precision} · ${pp.start}..${pp.end} · sin límites expandidos=${!t.includes('2026-09-01')} · sin fecha de entrega=${!t.includes('2026-10-13')}`];
    }));

  await caso('PERÍODO desconocido: con entrega fechada, sigue DESCONOCIDO y sin precisión deducida', () =>
    conConcesion(idDe('LOT-2026-00002'), (v) => {
      const pp = v.body?.production_period;
      if (!pp) return [false, 'la vista no trae production_period'];
      const t = JSON.stringify(pp);
      return [v.status === 200 && pp.precision === 'UNKNOWN' && pp.start === null && pp.end === null
        && !t.includes('2026-10-13') && !t.includes('DERIVED'),
        `precisión=${pp.precision} · fechas=${pp.start ?? 'ninguna'} · sin fecha de entrega=${!t.includes('2026-10-13')} · sin DERIVED=${!t.includes('DERIVED')}`];
    }));
}

// ------------------------------------------------------------------ NAVEGADOR
const navegador = await chromium.launch();
try {
  const ctx = await navegador.newContext({ locale: 'es-EC', viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const entrar = async (c) => {
    await page.goto(WEB);
    await page.getByLabel('Correo').fill(c.cuenta.email);
    await page.getByLabel('Contraseña').fill(c.cuenta.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.waitForLoadState('networkidle');
  };
  const esperar = (re, ms = 15000) => page.waitForFunction((f) => new RegExp(f).test(document.body.innerText), re.source, { timeout: ms });

  await entrar(comprador);

  await caso('PORTAL: el destinatario ENCUENTRA sus recursos concedidos', async () => {
    await page.goto(`${WEB}/compartido`);
    await esperar(/Recursos compartidos contigo/);
    await esperar(/Lote/);
    const filas = await page.locator('table[aria-label="Recursos compartidos contigo"] tbody tr').count();
    return [filas >= 1, `${filas} concesión(es) en su lista`];
  });

  await caso('PORTAL: declara que no levanta la clasificación ni sustituye un paquete DD', async () => {
    const t = await page.locator('body').innerText();
    return [/no incluye identidad de productores/i.test(t) && /no es un paquete dd/i.test(t), 'ambos avisos presentes'];
  });

  await caso('TECLADO: abre su vista sin ratón y ve solo agregados', async () => {
    const boton = page.getByRole('button', { name: 'Ver' }).first();
    await boton.focus();
    const enfocado = await boton.evaluate((el) => el === document.activeElement);
    await page.keyboard.press('Enter');
    await esperar(/Productores/);
    const t = await page.locator('body').innerText();
    const sinIdentidad = !/legal_name|document_number/i.test(t);
    return [enfocado && sinIdentidad, `foco=${enfocado} · sin identidad en pantalla=${sinIdentidad}`];
  });

  await caso('INDICADORES: los once de S3 §22.8 se ven, con estado y significado', async () => {
    await esperar(/Estado del lote/);
    const filas = await page.locator('table[aria-label="Indicadores del lote"] tbody tr').count();
    const t = await page.locator('body').innerText();
    // Dos recuentos (productores, parcelas) + nueve estados = los once de la fuente.
    const recuentos = /Productores/.test(t) && /Parcelas/.test(t);
    return [filas === 9 && recuentos, `${filas} indicadores de estado + recuentos=${recuentos}`];
  });

  await caso('INDICADORES: lo desconocido NO se presenta como conforme', async () => {
    const t = await page.locator('body').innerText();
    const avisa = /no significan conforme/i.test(t);
    const hayNoEvaluable = /No evaluable|Sin evaluar/.test(t);
    // Y las distinciones que no se pueden perder están escritas en pantalla.
    const distingue = /no es una conclusión regulatoria/i.test(t) && /NO presenta declaraciones/i.test(t);
    return [avisa && hayNoEvaluable && distingue, `avisa=${avisa} · estados no concluyentes visibles=${hayNoEvaluable} · distinciones=${distingue}`];
  });

  await caso('PERÍODO en pantalla: precisión declarada o «desconocido», nunca una deducción', async () => {
    const t = await page.locator('body').innerText();
    const hay = /Período de producción/.test(t);
    const honesto = /precisión de (día|mes)|declarado desconocido|sin declarar|desconocido/i.test(t);
    // Lo que NO puede aparecer: una precisión deducida de la fecha de entrega.
    const limpio = !/DEDUCIDO de la fecha de entrega|DERIVED/i.test(t);
    return [hay && honesto && limpio, `visible=${hay} · precisión honesta=${honesto} · sin deducción=${limpio}`];
  });

  await caso('DESCARGA: entrega la vista compartida interna, identificada como tal', async () => {
    const [descarga] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.getByRole('button', { name: 'Descargar' }).first().click(),
    ]);
    await esperar(/vista compartida interna/i);
    return [!!descarga.suggestedFilename(), `archivo=${descarga.suggestedFilename()}`];
  });

  await caso('ENLACE: abrir /r/<referencia> lleva al destinatario a SU vista', async () => {
    await page.goto(`${WEB}/r/${referencia}`);
    await page.waitForURL(/\/compartido$/, { timeout: 15000 });
    await esperar(/Recursos compartidos contigo/);
    return [page.url().endsWith('/compartido'), `terminó en ${page.url().replace(WEB, '')}`];
  });

  await caso('390 px: el portal se usa sin desbordamiento horizontal', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${WEB}/compartido`);
    await esperar(/Recursos compartidos contigo/);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    return [!desborda, `desborda=${desborda}`];
  });

  // --------------------------------------------------------------- revocación
  await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/access-grants/${grant}/revoke`, { operation_id: randomUUID(), reason: 'Fin de la revisión de despliegue' });

  await caso('REVOCACIÓN: se corta la resolución, la vista y el portal queda vacío', async () => {
    const r = await pedir(comprador.token, 'GET', `/api/v1/public-references/${referencia}`);
    const v = await pedir(comprador.token, 'GET', `/api/v1/granted/${grant}`);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${WEB}/compartido`);
    await esperar(/Recursos compartidos contigo/);
    const t = await page.locator('body').innerText();
    const vacio = /Todavía no hay nada compartido contigo|no hay nada compartido/i.test(t);
    return [r.status === 404 && v.status === 404 && vacio, `resolución=${r.status} · vista=${v.status} · portal vacío=${vacio}`];
  });
} finally {
  await navegador.close();
  await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/access-grants/${grant}/revoke`, { operation_id: randomUUID(), reason: 'Cierre' });
}

const ok = resultados.every(Boolean);
console.log(`\nP1-001/P1-002 portal del destinatario: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;
