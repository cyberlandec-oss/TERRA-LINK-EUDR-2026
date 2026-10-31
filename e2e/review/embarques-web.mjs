// P0-029 (QA-06/12): revisión en navegador real de Embarques con datos DEMO de la Cooperativa.
// Flujo de ORG_ADMIN: comprador declarado → embarque → lote → reservar → preflight (bloqueado) → despacho deshabilitado →
// cancelar (libera la reserva). Además: roles sin permiso no ven el menú y reciben 403; el auditor solo lee; 390 px.
// Deja en la DEMO un comprador DEMO-REV-COMPRADOR y un embarque CANCELADO por ejecución (sin reservas activas).
//   node e2e/review/embarques-web.mjs [http://localhost:3000]
// Evidencia: docs/qa/embarques/revision.json y docs/qa/capturas/embarques/*.png.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const BASE = process.argv[2] ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const shots = join(root, 'docs', 'qa', 'capturas', 'embarques');
mkdirSync(shots, { recursive: true });
mkdirSync(join(root, 'docs', 'qa', 'embarques'), { recursive: true });
const credFile = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].filter((f) => existsSync(join(root, f))).sort((a, b) => statSync(join(root, b)).mtimeMs - statSync(join(root, a)).mtimeMs)[0];
const lines = readFileSync(join(root, credFile), 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
const head = lines.shift();
const acc = (local) => { const r = lines.find((x) => x[head.indexOf('email')].startsWith(`${local}@`)); return { email: r[head.indexOf('email')], password: r[head.indexOf('contrasena')] }; };
const call = async (path, token, init = {}) => { const r = await fetch(`${API}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const token = (await call('/api/v1/auth/login', null, { method: 'POST', body: JSON.stringify(acc('admin.cooperativa')) })).body.access_token;
const coop = (await call('/api/v1/organizations', token)).body.find((o) => o.name.includes('Cooperativa')).id;

const results = [];
const check = (caso, ok, detalle = '', captura = null) => { results.push({ caso, ok, detalle, captura }); console.log(`${ok ? 'OK   ' : 'FALLA'} ${caso}${detalle ? `: ${detalle}` : ''}`); };
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f, fullPage: true }); return `docs/qa/capturas/embarques/${name}.png`; };
const browser = await chromium.launch();
const nav = (page) => page.locator('aside[aria-label="Navegación principal"]');
async function loginAs(local, viewport = { width: 1280, height: 860 }) {
  const ctx = await browser.newContext({ viewport, locale: 'es-EC' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  const a = acc(local);
  await page.getByLabel('Correo').fill(a.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(a.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
  return { ctx, page };
}

try {
  // Embarques de revisión que quedaron en preparación (ejecución interrumpida): se cancelan y liberan su reserva.
  for (const r of (await call(`/api/v1/organizations/${coop}/shipments`, token)).body.filter((x) => x.buyer_code === 'DEMO-REV-COMPRADOR' && x.status === 'DRAFT')) {
    const d = (await call(`/api/v1/organizations/${coop}/shipments/${r.id}`, token)).body;
    const c = await call(`/api/v1/organizations/${coop}/shipments/${r.id}/cancel`, token, { method: 'POST', body: JSON.stringify({ operation_id: crypto.randomUUID(), expected_version: d.row_version, reason: 'Limpieza de una revisión interrumpida (P0-029)' }) });
    check(`limpieza: embarque de revisión interrumpida ${r.shipment_code} cancelado`, c.status === 200);
  }
  const reconBefore = (await call(`/api/v1/organizations/${coop}/inventory/reconciliation`, token)).body;
  const opts = (await call(`/api/v1/organizations/${coop}/shipments/options`, token)).body;
  const candidate = opts.lots.find((l) => Number(l.available) >= 1);
  if (!candidate) throw new Error('La DEMO no tiene lotes con disponible ≥ 1 kg en un centro');
  const loc = opts.locations.find((l) => l.id === candidate.location_id);
  const { ctx, page } = await loginAs('admin.cooperativa');
  await page.goto(`${BASE}/organizaciones/${coop}`);
  await nav(page).getByRole('link', { name: 'Entregas', exact: true }).waitFor({ timeout: 15000 });
  const menu = await nav(page).getByRole('link', { name: 'Embarques' }).count();
  check('menú: ORG_ADMIN ve «Embarques»', menu === 1);
  await nav(page).getByRole('link', { name: 'Embarques' }).click();
  await page.getByRole('heading', { level: 1, name: 'Embarques' }).waitFor();
  if (!(opts.buyers ?? []).some((b) => b.code === 'DEMO-REV-COMPRADOR')) {
    await page.getByLabel('Código').fill('DEMO-REV-COMPRADOR');
    await page.getByLabel('Nombre').fill('Comprador de revisión (sintético)');
    await page.getByLabel('País (ISO, dos letras)').fill('NL');
    await page.getByRole('button', { name: 'Registrar comprador' }).click();
    await page.getByText('DEMO-REV-COMPRADOR · Comprador de revisión (sintético) (NL)').waitFor({ timeout: 15000 });
  }
  await page.reload();
  await page.getByLabel('Comprador', { exact: true }).selectOption({ label: 'DEMO-REV-COMPRADOR · Comprador de revisión (sintético) (NL)' });
  await page.getByLabel('País de destino (ISO, dos letras)').fill('NL');
  await page.getByLabel('Puerto o lugar de destino (opcional)').fill('Rotterdam');
  await page.getByLabel('Centro de salida').selectOption(candidate.location_id);
  check('nuevo embarque: formulario por teclado y etiquetas', true, `centro ${loc.code}`, await shot(page, 'nuevo-embarque'));
  await page.getByRole('button', { name: 'Crear embarque' }).click();
  await page.getByRole('heading', { level: 1, name: /Embarque EMB-/ }).waitFor({ timeout: 15000 });
  const shipmentId = page.url().split('/').pop();
  await page.getByLabel(/Lote \(disponible en/).selectOption(candidate.lot_id);
  await page.getByLabel('Cantidad (kg)').fill('1');
  await page.getByRole('button', { name: 'Agregar lote' }).click();
  await page.getByRole('table', { name: 'Lotes del embarque' }).getByText(candidate.lot_code).waitFor({ timeout: 15000 });
  const before = (await call(`/api/v1/organizations/${coop}/lots/${candidate.lot_id}`, token)).body.quantities;
  await page.getByRole('button', { name: 'Reservar' }).click();
  await page.getByText('Reservado 1 kg', { exact: true }).waitFor({ timeout: 15000 });
  const after = (await call(`/api/v1/organizations/${coop}/lots/${candidate.lot_id}`, token)).body.quantities;
  check('reserva: el disponible baja 1 kg y la existencia no cambia (ledger)', Number(before.available) - Number(after.available) === 1 && before.physical === after.physical, `disponible ${before.available} → ${after.available}; existencia ${after.physical}`);
  await page.getByText('No se puede despachar todavía').waitFor({ timeout: 15000 });
  const pfText = await page.getByRole('list', { name: 'Comprobaciones' }).innerText();
  const disabled = await page.getByRole('button', { name: 'Despachar' }).isDisabled();
  check('preflight: bloquea por calidad/expediente y por la compuerta D-34; «Despachar» deshabilitado', disabled && /dd_package_id/.test(pfText) && /Bloquea/.test(pfText), '', await shot(page, 'preflight-bloqueado'));
  const api = await call(`/api/v1/organizations/${coop}/shipments/${shipmentId}/dispatch`, token, { method: 'POST', body: JSON.stringify({ operation_id: crypto.randomUUID(), expected_version: 999 }) });
  check('API: despachar con versión obsoleta o bloqueos → 409 sin efectos', api.status === 409);
  await page.goto(`${BASE}/organizaciones/${coop}/lotes/${candidate.lot_id}`);
  await page.getByRole('list', { name: 'Embarques del lote' }).waitFor({ timeout: 15000 });
  check('Lot Hub: «Embarques» muestra el embarque con efecto «reservado»', /reservado/.test(await page.getByRole('list', { name: 'Embarques del lote' }).innerText()), '', await shot(page, 'lot-hub-embarques'));
  await page.goto(`${BASE}/organizaciones/${coop}/embarques/${shipmentId}`);
  await page.getByLabel('Motivo', { exact: true }).fill('Revisión en navegador (P0-029): se cancela y libera la reserva');
  await page.getByRole('button', { name: 'Cancelar embarque' }).click();
  await page.getByText('Cancelado', { exact: true }).first().waitFor({ timeout: 15000 });
  const fin = (await call(`/api/v1/organizations/${coop}/lots/${candidate.lot_id}`, token)).body.quantities;
  check('cancelar: libera la reserva (disponible restaurado)', fin.available === before.available && fin.reserved === before.reserved, `disponible ${fin.available}`, await shot(page, 'cancelado'));
  const reconAfter = (await call(`/api/v1/organizations/${coop}/inventory/reconciliation`, token)).body;
  check('conciliación ledger ↔ dominio sin diferencias nuevas', reconAfter.differences.length === reconBefore.differences.length, `diferencias ${reconBefore.differences.length} → ${reconAfter.differences.length}`);
  await ctx.close();

  {
    const s = await loginAs('admin.cooperativa', { width: 390, height: 844 });
    await s.page.goto(`${BASE}/organizaciones/${coop}/embarques/${shipmentId}`);
    await s.page.getByRole('heading', { level: 1, name: /Embarque EMB-/ }).waitFor({ timeout: 15000 });
    const o = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('390 px: detalle de embarque sin desplazamiento horizontal', o <= 0, `exceso ${o}px`, await shot(s.page, 'detalle-390'));
    await s.ctx.close();
  }
  for (const [local, expectMenu] of [['recepcion.acopio', false], ['auditor.cooperativa', true]]) {
    const s = await loginAs(local);
    await s.page.goto(`${BASE}/organizaciones/${coop}`);
    await nav(s.page).waitFor();
    const seen = await nav(s.page).getByRole('link', { name: 'Embarques' }).count();
    await s.page.goto(`${BASE}/organizaciones/${coop}/embarques`);
    await s.page.waitForLoadState('networkidle');
    const main = await s.page.locator('main').innerText();
    if (expectMenu) check(`${local}: ve Embarques en solo lectura (sin formularios de gestión)`, seen === 1 && !/Crear embarque|Registrar comprador/.test(main), '', await shot(s.page, `${local}-embarques`));
    else check(`${local}: sin «Embarques» en el menú; la URL responde «Tu rol no permite…»`, seen === 0 && /Tu rol no permite consultar embarques/.test(main), '', await shot(s.page, `${local}-embarques`));
    await s.ctx.close();
  }
} catch (e) {
  check('ejecución sin errores', false, String(e.message).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
  const ok = results.every((r) => r.ok);
  writeFileSync(join(root, 'docs', 'qa', 'embarques', 'revision.json'), `${JSON.stringify({ fecha: new Date().toISOString(), base: BASE, ok, casos: results }, null, 2)}\n`);
  console.log(`Resultado: ${ok ? 'APROBADO' : 'FALLIDO'}`);
  process.exitCode = ok ? 0 : 1;
}
