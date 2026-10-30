// Comprobación SOLO LECTURA, en navegador real, del resultado ya guardado del ensayo con Whisp (geometría artificial): se puede consultar y descargar sin habilitar nuevos encargos.
//   node e2e/review/whisp-resultado-web.mjs [http://localhost:3000]
// No encarga ningún análisis, no cambia configuración ni datos. Credenciales: CREDENCIALES.csv (no se imprimen).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const ORG = 'fb6ab743-d3ea-4602-aaa6-88d30028356e';
const rows = readFileSync('CREDENCIALES.csv', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const h = rows[0];
const cuenta = (rolPrefijo) => { const r = rows.find((x) => x[h.indexOf('rol')].startsWith(rolPrefijo) && x[h.indexOf('organizacion')] === 'DEMO · Exportadora Pacífico'); return { email: r[h.indexOf('email')], pass: r[h.indexOf('contrasena')] }; };
const shots = join('docs', 'qa', 'capturas', 'web-por-rol'); mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-EC', acceptDownloads: true });
const page = await ctx.newPage();
const a = cuenta('ORG_ADMIN');
await page.goto(BASE);
await page.getByLabel('Correo').fill(a.email);
await page.getByLabel('Contraseña', { exact: true }).fill(a.pass);
await page.getByRole('button', { name: 'Iniciar sesión' }).click();
await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
const posts = []; page.on('request', (r) => { if (r.method() === 'POST' && /satellite/.test(r.url())) posts.push(r.url()); });
await page.goto(`${BASE}/organizaciones/${ORG}/parcelas`);
await page.getByRole('link', { name: /ENSAYO-WHISP-ART-A/ }).click();
await page.getByRole('heading', { name: /ENSAYO-WHISP-ART-A/ }).waitFor();
await page.waitForLoadState('networkidle');
const card = page.getByRole('region', { name: 'Análisis satelital' });
const visible = await card.count();
const text = visible ? await card.innerText() : '';
await page.screenshot({ path: join(shots, 'whisp-resultado--admin-exportadora.png'), fullPage: true });
const botonesSolicitar = visible ? await card.getByRole('button', { name: /Solicitar/ }).count() : 0;
let descarga = null;
const dl = visible ? card.getByRole('button', { name: /Descargar|original/i }) : null;
if (dl && await dl.count()) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), dl.first().click()]);
  const p = await d.path(); const buf = readFileSync(p);
  descarga = { nombre: d.suggestedFilename(), bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
}
const comprobaciones = {
  tarjeta_visible: visible === 1,
  resultado_disponible: /Resultado disponible/i.test(text),
  // Dos estados distintos en pantalla: el resultado guardado (consultable) y «nuevos análisis deshabilitados» (no se puede encargar).
  nuevos_analisis_deshabilitados_separado: /Nuevos análisis deshabilitados/.test(text) && /no habilita nuevos análisis/.test(text) && /Resultado disponible/.test(text),
  cobertura_unknown: /UNKNOWN|desconocida/i.test(text),
  procedencia_y_fecha: /Whisp/.test(text) && /2026/.test(text),
  limitaciones: /certific|límites|limitaciones/i.test(text),
  no_conclusion_favorable: !/sin deforestaci[oó]n\b(?!.*no equivale)/i.test(text.replace(/«Sin alertas» no equivale a «sin deforestación»/g, '')) && /NOT_EVALUATED|NO EVALUADO|no es una conclusi/i.test(text),
  // La tarjeta dice «Consulta real al proveedor»; que la geometría es artificial lo dice la parcela rotulada (cabecera), no un campo de la tarjeta.
  origen_consulta_real: /Consulta real al proveedor, guardada en Terra Link/.test(text),
  parcela_rotulada_ensayo_artificial: /ENSAYO-WHISP-ART-A/.test(await page.getByRole('heading', { level: 1 }).first().innerText().catch(() => '')) || /ENSAYO-WHISP-ART/.test(await page.locator('main').first().innerText().catch(() => '')),
  botones_solicitar: botonesSolicitar,
  posts_a_satellite_durante_la_consulta: posts.length,
  descarga,
};
writeFileSync(join('docs', 'qa', 'whisp-resultado-web.json'), `${JSON.stringify({ en: new Date().toISOString(), comprobaciones, texto_tarjeta: text }, null, 2)}\n`);
console.log(JSON.stringify(comprobaciones, null, 2));
console.log('--- texto de la tarjeta ---\n' + text.slice(0, 3500));
await browser.close();
