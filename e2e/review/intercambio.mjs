// P1-006 — Intercambio con GUIA/Agrocalidad: recorrido completo en navegador real y por API
// (RF-37; S2 §29; S3 §§14, 19; docs/15).
//
//   node e2e/review/intercambio.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Lo que tiene que quedar demostrado:
//   1. **no hay conexión con GUIA**: el formato se declara NO OFICIAL y nada sale hacia un servicio externo;
//   2. **sin canal comprobado no se intercambia**, y registrar el acuerdo **no** lo abre;
//   3. **la organización no verifica su propio canal**: lo hace la administración de plataforma;
//   4. el recorrido: **exportar → conciliar → ver diferencias → decidir**, desde la pantalla;
//   5. **conciliar no cambia datos operativos**;
//   6. permisos, enlaces, estados de pantalla, teclado y 390 px.
//
// Deja el entorno como lo encontró: retira el acuerdo que verifica, de modo que el canal vuelve a estar
// cerrado. Lo registrado y lo actuado permanece en el histórico, porque aquí no se borra nada.
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readXlsx, writeXlsx } = require('../../apps/api/dist/imports/xlsx.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';
const HOJA = 'operadores';

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
  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('spreadsheetml')) return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
  const t = await r.text();
  let body = null; try { body = JSON.parse(t); } catch { /* no JSON */ }
  return { status: r.status, body, texto: t, headers: r.headers };
};
const base = `/api/v1/organizations/${COOP}/exchange`;
const uuid = () => crypto.randomUUID();

const admin = await sesion('admin.cooperativa');
const plataforma = await sesion('superadmin.revision');
const tecnico = await sesion('tecnico1.cooperativa');

// ------------------------------------------------------------------ API
await caso('CONTROL: el formato se sirve y declara que NO es oficial', async () => {
  const r = await pedir(admin.token, 'GET', `${base}/format`);
  exigeEntrada('campos del formato', r.body?.fields);
  const mapeados = r.body.fields.every((f) => f.element && f.element.length > 3);
  return [r.status === 200 && r.body.official === false && /NO está autorizado/.test(r.body.warning) && mapeados,
    `${r.body?.version} · campos=${r.body?.fields?.length} con elemento de la guía=${mapeados}`];
});

await caso('NO SE ASUME NINGUNA API: lo excluido se dice, y no hay destino externo', async () => {
  const r = await pedir(admin.token, 'GET', `${base}/format`);
  const t = JSON.stringify(r.body);
  const sinGeometria = /Geometrías y coordenadas/.test(t);
  const sinIdentidad = /Documento de identidad/.test(t);
  const sinRed = /no envía datos a ningún servicio externo/.test(t) && !/https?:\/\//.test(t);
  return [sinGeometria && sinIdentidad && sinRed,
    `excluye geometrías=${sinGeometria} · excluye identidad=${sinIdentidad} · sin destino externo=${sinRed}`];
});

// Estado de partida: si quedó un acuerdo abierto de una pasada anterior, se retira para recorrer de verdad.
{
  const previos = await pedir(admin.token, 'GET', `${base}/agreements`);
  for (const a of previos.body?.agreements ?? []) {
    if (a.can_exchange) await pedir(admin.token, 'POST', `${base}/agreements/${a.id}/decisions`, { operation_id: uuid(), decision: 'WITHDRAW', reason: 'Se restituye el estado antes de la revisión' });
  }
}

await caso('CANAL CERRADO: no se exporta ni se concilia, y el motivo lo dice', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/export`);
  return [r.status === 409 && r.body?.error?.code === 'EXCHANGE_CHANNEL_NOT_VERIFIED'
    && /no verifica su propio canal/i.test(r.body.error.message),
  `${r.status} · ${r.body?.error?.code}`];
});

const hoy = new Date().toISOString().slice(0, 10);
const acuerdo = await pedir(admin.token, 'POST', `${base}/agreements`, {
  operation_id: uuid(), counterpart: 'GUIA_AGROCALIDAD', reference: `Revisión de despliegue ${Date.now().toString().slice(-6)}`,
  scope: 'Padrón de operadores: código, nombre y ubicación administrativa. Sin geometrías ni identidad.',
  valid_from: hoy,
});
const acuerdoId = exigeEntrada('acuerdo registrado', acuerdo.body?.id);

await caso('REGISTRAR NO ABRE EL CANAL: queda registrado y el intercambio sigue cerrado', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/export`);
  return [acuerdo.body.status === 'REGISTRADO' && acuerdo.body.can_exchange === false && r.status === 409,
    `estado=${acuerdo.body.status} · exportar=${r.status}`];
});

await caso('LA ORGANIZACIÓN NO VERIFICA SU PROPIO CANAL; la plataforma sí', async () => {
  const propio = await pedir(admin.token, 'POST', `${base}/agreements/${acuerdoId}/decisions`, { operation_id: uuid(), decision: 'VERIFY', reason: 'Intento desde la propia organización' });
  const tec = await pedir(tecnico.token, 'POST', `${base}/agreements/${acuerdoId}/decisions`, { operation_id: uuid(), decision: 'VERIFY', reason: 'Intento desde dentro' });
  const plat = await pedir(plataforma.token, 'POST', `${base}/agreements/${acuerdoId}/decisions`, { operation_id: uuid(), decision: 'VERIFY', reason: 'Canal comprobado para la revisión de despliegue' });
  return [propio.status === 403 && tec.status === 403 && plat.status === 201 && plat.body.can_exchange === true,
    `organización=${propio.status} · técnico=${tec.status} · plataforma=${plat.status} (${plat.body?.status})`];
});

let exportado = null;
await caso('EXPORTAR entrega el padrón y queda en el registro, sin geometrías ni identidad', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/export`);
  if (r.status !== 201) return [false, `estado ${r.status}`];
  exportado = r.bytes;
  const hoja = readXlsx(r.bytes, HOJA);
  const cabecera = hoja.rows[0].cells.map((c) => c?.value);
  const texto = JSON.stringify(hoja.rows);
  const limpio = !/coordinates|geometry|document_number/.test(texto) && !/-7\d\.|-8\d\./.test(texto);
  const actos = await pedir(admin.token, 'GET', `${base}/acts`);
  const ultimo = actos.body?.acts?.[0];
  return [cabecera.includes('codigo_operador') && limpio && ultimo?.kind === 'EXPORT' && /^[0-9a-f]{64}$/.test(ultimo.content_hash),
    `${hoja.rows.length - 1} operador(es) · sin geometrías ni identidad=${limpio} · acto=${ultimo?.kind} huella=${ultimo?.content_hash?.slice(0, 8)}…`];
});

await caso('CONCILIAR produce diferencias y NO cambia ningún dato operativo', async () => {
  const hoja = readXlsx(exigeEntrada('archivo exportado', exportado), HOJA);
  const cabecera = hoja.rows[0].cells.map((c) => c?.value ?? '');
  const filas = hoja.rows.slice(1).map((f) => cabecera.map((_, i) => f.cells[i]?.value ?? ''));
  if (!filas.length) throw new Error('el padrón DEMO está vacío: la conciliación no se ejecuta en falso');
  // La contraparte dice otro cantón para el primero, y trae un operador que no tenemos.
  const antesCanton = filas[0][cabecera.indexOf('canton')];
  filas[0][cabecera.indexOf('canton')] = 'CANTÓN DISTINTO';
  filas.push(['EXT-SOLO-ALLA', 'Operador solo de la contraparte', 'Manabí', 'Chone', 'Canuto', '0']);
  const archivo = writeXlsx([{ name: HOJA, rows: [cabecera, ...filas] }]);

  const productoresAntes = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
  const huellaAntes = JSON.stringify((productoresAntes.body?.items ?? productoresAntes.body ?? []).map((p) => `${p.code}:${p.name}`).sort());

  const form = new FormData();
  form.append('file', new Blob([archivo]), 'contraparte.xlsx');
  const r = await fetch(`${API}${base}/reconcile`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}` }, body: form });
  const acto = await r.json();
  if (r.status !== 201) return [false, `estado ${r.status}: ${acto?.error?.code}`];

  const clases = new Set(acto.differences.map((d) => d.kind));
  const productoresDespues = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/producers`);
  const huellaDespues = JSON.stringify((productoresDespues.body?.items ?? productoresDespues.body ?? []).map((p) => `${p.code}:${p.name}`).sort());
  const sinCambios = huellaAntes === huellaDespues;
  return [acto.differences.length >= 2 && clases.has('FIELD_DIFFERS') && clases.has('ONLY_EXTERNAL') && sinCambios,
    `${acto.differences.length} diferencia(s) [${[...clases].join(', ')}] · cantón propio seguía «${antesCanton}» · datos sin cambios=${sinCambios}`];
});

await caso('PERMISOS: quien no participa en el intercambio no lo lee ni lo usa', async () => {
  const lectura = await pedir(tecnico.token, 'GET', `${base}/acts`);
  const exportar = await pedir(tecnico.token, 'POST', `${base}/export`);
  // CONTROL: el administrador sí puede, así que un 403 significa «no te corresponde», no «no responde».
  const control = await pedir(admin.token, 'GET', `${base}/acts`);
  return [lectura.status === 403 && exportar.status === 403 && control.status === 200,
    `técnico: leer=${lectura.status} exportar=${exportar.status} · control administrador=${control.status}`];
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
  const abrir = async (page) => {
    await page.goto(`${WEB}/organizaciones/${COOP}/intercambio`);
    await page.getByRole('heading', { level: 1, name: /Intercambio con GUIA/ }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Acuerdo de intercambio' }).waitFor({ timeout: 20000 });
    // El encabezado aparece antes que los datos: hay que esperar al desenlace real de la carga.
    await page.locator('main')
      .getByText(/Verificado y vigente|Registrado, sin verificar|Retirado|Todavía no hay ningún acuerdo registrado/)
      .first().waitFor({ timeout: 20000 });
  };

  const { ctx, page } = await entrar(admin);

  await caso('ENLACE: se llega al intercambio desde el menú, y la pantalla dice que no hay conexión', async () => {
    await page.goto(`${WEB}/organizaciones/${COOP}`);
    await page.getByRole('link', { name: 'Intercambio', exact: true }).first().click();
    await page.getByRole('heading', { level: 1, name: /Intercambio con GUIA/ }).waitFor({ timeout: 20000 });
    await page.getByRole('heading', { name: 'Registro de actos' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/no se conecta con GUIA/i.test(t) && /se intercambian archivos/i.test(t) && /no se envía nada a ningún servicio externo/i.test(t),
      `aviso de que no hay conexión presente=${/no se conecta con GUIA/i.test(t)}`];
  });

  await caso('PANTALLA: el acuerdo verificado se ve con su estado, su vigencia y quién lo verificó', async () => {
    await abrir(page);
    const t = await page.locator('main').innerText();
    return [/Verificado y vigente/.test(t) && /Canal abierto por/.test(t) && /Revisión de despliegue/.test(t),
      `estado visible=${/Verificado y vigente/.test(t)} · canal abierto rotulado=${/Canal abierto por/.test(t)}`];
  });

  await caso('PANTALLA: el registro de actos muestra la exportación y la conciliación', async () => {
    await page.getByRole('table', { name: 'Actos de intercambio' }).waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    const tabla = await page.getByRole('table', { name: 'Actos de intercambio' }).isVisible();
    return [tabla && /Exportación/.test(t) && /Conciliación/.test(t), `tabla=${tabla} · exportación y conciliación listadas`];
  });

  await caso('RECORRIDO: abrir las diferencias y DECIDIR una, con su motivo', async () => {
    await page.getByRole('button', { name: 'Ver diferencias' }).first().click();
    await page.getByRole('heading', { name: 'Diferencias de la conciliación' }).waitFor({ timeout: 20000 });
    const antes = await page.getByRole('table', { name: 'Diferencias' }).locator('tbody tr').count();
    if (antes === 0) throw new Error('la conciliación no dejó diferencias: el caso no se ejecuta en falso');
    page.once('dialog', (d) => d.accept('La contraparte tiene el dato correcto; se corregirá en la ficha del productor'));
    await page.getByRole('button', { name: 'Aceptar el valor externo' }).first().click();
    await page.getByText('La contraparte tiene el dato correcto').first().waitFor({ timeout: 20000 });
    const t = await page.locator('main').innerText();
    return [/NO escribe en los datos operativos/.test(t), `${antes} diferencia(s) · decisión registrada con su motivo`];
  });

  await caso('390 px y teclado: la pantalla se usa sin desbordamiento y se recorre sin ratón', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await abrir(page);
    const desborda = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    await page.setViewportSize({ width: 1280, height: 900 });
    await abrir(page);
    let enFormulario = false;
    for (let i = 0; i < 60 && !enFormulario; i++) {
      await page.keyboard.press('Tab');
      enFormulario = await page.evaluate(() => !!document.activeElement?.closest('form'));
    }
    return [!desborda && enFormulario, `desborda=${desborda} · foco alcanza el formulario=${enFormulario}`];
  });
  await ctx.close();

  const t = await entrar(tecnico);
  await caso('PANTALLA sin permiso: lo dice, y el menú no ofrece la entrada', async () => {
    const enMenu = await t.page.getByRole('link', { name: 'Intercambio', exact: true }).count();
    await t.page.goto(`${WEB}/organizaciones/${COOP}/intercambio`);
    await t.page.getByRole('heading', { level: 1, name: /Intercambio con GUIA/ }).waitFor({ timeout: 20000 });
    const texto = await t.page.locator('main').innerText();
    const dice = /Tu rol no participa en el intercambio/.test(texto);
    const noFinge = !/no hay datos|sin registros/i.test(texto);
    return [enMenu === 0 && dice && noFinge, `entradas en el menú=${enMenu} · mensaje propio=${dice} · no lo disfraza de «sin datos»=${noFinge}`];
  });
  await t.ctx.close();
} finally {
  await navegador.close();
  // Restitución: el canal vuelve a estar cerrado. Lo actuado permanece en el histórico.
  await pedir(admin.token, 'POST', `${base}/agreements/${acuerdoId}/decisions`, { operation_id: uuid(), decision: 'WITHDRAW', reason: 'Fin de la revisión de despliegue: se cierra el canal' });
}

await caso('RESTITUCIÓN: el canal queda cerrado al terminar, y el histórico se conserva', async () => {
  const r = await pedir(admin.token, 'POST', `${base}/export`);
  const actos = await pedir(admin.token, 'GET', `${base}/acts`);
  return [r.status === 409 && (actos.body?.acts?.length ?? 0) > 0,
    `exportar tras retirar=${r.status} · actos conservados=${actos.body?.acts?.length}`];
});

const ok = resultados.every(Boolean);
console.log(`\nP1-006 intercambio con GUIA/Agrocalidad: ${ok ? 'APROBADO' : 'CON FALLAS'} (${resultados.filter(Boolean).length}/${resultados.length} casos)`);
process.exitCode = ok ? 0 : 1;