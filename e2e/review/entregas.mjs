// Revisión de P0-012 sobre el recorrido DEMO (Cooperativa): administrador (entrega con soporte y recepción parcial),
// técnico asignado (390 px: su borrador, sin recibir), operador de recepción (teclado: revisión previa visible, sin
// identidad del productor) y operador de calidad (390 px: registra UN resultado sin decisión, una sola vez).
// No confirma recepciones ni registra decisiones de calidad sobre los datos DEMO. Nunca imprime contraseñas.
import { join } from 'node:path';

export async function reviewDeliveries({ browser, BASE, accounts, DEMO_ORGS, orgIdByName, shots }) {
  const acc = (local) => accounts.find((x) => x.email.startsWith(local));
  const coop = orgIdByName[DEMO_ORGS.find((o) => o.includes('Cooperativa'))];
  const loginAs = async (a, viewport = { width: 1280, height: 860 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'es-EC' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.getByLabel('Correo').fill(a.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(a.contrasena);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();
    await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 15000 });
    return { ctx, page };
  };
  const list = async (page) => {
    await page.goto(`${BASE}/organizaciones/${coop}/entregas`);
    await page.getByRole('table', { name: 'Entregas' }).or(page.getByText('Aún no hay entregas a tu alcance.')).first().waitFor({ timeout: 15000 });
  };
  const casos = [];
  {
    const { ctx, page } = await loginAs(acc('admin.cooperativa'));
    await list(page);
    await page.getByRole('row', { name: /DEMO-RV-001/ }).getByRole('link').first().click();
    await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor({ timeout: 15000 });
    const text = await page.locator('main').innerText();
    await page.screenshot({ path: join(shots, 'entregas--admin-detalle.png'), fullPage: true });
    const ok = text.includes('Mes: septiembre de 2026') && text.includes('Nota de entrega o recibo firmado') && text.includes('Recepción parcial') && text.includes('Pendiente de evaluación') && /no es un expediente completo/.test(text);
    casos.push({ cuenta: 'admin.cooperativa', resultado: `periodo por mes sin días; soporte vinculado (sin aprobar); recepción parcial; calidad pendiente; aviso de no conformidad=${ok}`, ok });
    await ctx.close();
  }
  {
    const { ctx, page } = await loginAs(acc('tecnico1.cooperativa'), { width: 390, height: 844 });
    await list(page);
    const rows = await page.getByRole('table', { name: 'Entregas' }).locator('tbody tr').allInnerTexts();
    const onlyAssigned = rows.length > 0 && rows.every((r) => !r.includes('DEMO-RV-005'));
    await page.getByRole('row', { name: /DEMO-RV-002/ }).getByRole('link').first().click();
    await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor({ timeout: 15000 });
    const receive = await page.getByRole('button', { name: 'Revisar recepción' }).count();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await page.screenshot({ path: join(shots, 'entregas--tecnico1-390.png'), fullPage: true });
    casos.push({ cuenta: 'tecnico1.cooperativa (390 px)', resultado: `solo entregas de productores asignados=${onlyAssigned}; borrador visible; puede recibir=${receive}; desborde=${overflow}`, ok: onlyAssigned && receive === 0 && !overflow });
    await ctx.close();
  }
  {
    const rec = acc('recepcion.acopio');
    if (rec) {
      const { ctx, page } = await loginAs(rec);
      await list(page);
      await page.getByRole('row', { name: /DEMO-RV-005/ }).getByRole('link').first().click();
      await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor({ timeout: 15000 });
      const text = await page.locator('main').innerText();
      const noIdentity = text.includes('identidad no visible para tu rol');
      await page.getByLabel('Peso recibido (kg)').fill('1');
      await page.getByLabel('Método de pesaje').fill('Revisión DEMO (no se confirma)');
      await page.getByRole('button', { name: 'Revisar recepción' }).focus();
      await page.keyboard.press('Enter');
      const review = await page.getByText('Revisa antes de confirmar').count();
      await page.screenshot({ path: join(shots, 'entregas--recepcion-revision.png'), fullPage: true });
      await page.getByRole('button', { name: 'Volver a editar' }).click(); // no se registra nada sobre los datos DEMO
      casos.push({ cuenta: 'recepcion.acopio (membresía en la Cooperativa, teclado)', resultado: `origen faltante y periodo desconocido visibles=${text.includes('Origen faltante') && text.includes('Desconocido (declarado')}; sin identidad del productor=${noIdentity}; revisión previa con Enter=${review === 1}`,
        ok: noIdentity && review === 1 && text.includes('Origen faltante') });
      await ctx.close();
    }
  }
  // Membresías DEMO adicionales (solo revisión): permisos efectivos por organización desde la API, sin contraseñas.
  const API = process.env.API_URL ?? 'http://localhost:4000';
  const acopio = orgIdByName[DEMO_ORGS.find((o) => o.includes('Acopio'))];
  for (const local of ['recepcion.acopio', 'calidad.acopio']) {
    const a = acc(local);
    if (!a) continue;
    const tok = (await (await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: a.email, password: a.contrasena }) })).json()).access_token;
    const perms = await (await fetch(`${API}/api/v1/me/permissions`, { headers: { authorization: `Bearer ${tok}` } })).json();
    const byOrg = Object.fromEntries(perms.organizations.map((o) => [o.organization_id, o]));
    const c = byOrg[coop]; const q = byOrg[acopio];
    const expected = local.startsWith('recepcion') ? 'RECEPTION_OPERATOR' : 'QUALITY_OPERATOR';
    const same = c && q && c.roles.join() === expected && q.roles.join() === expected && c.permissions.join() === q.permissions.join();
    const keyPerms = local.startsWith('recepcion') ? ['reception:confirm', 'quality:record'] : ['quality:record', 'quality:decide'];
    const lacks = local.startsWith('recepcion') ? ['quality:decide', 'document:read', 'producer:read_identity'] : ['reception:confirm', 'delivery:create', 'document:read'];
    const okPerms = !!same && keyPerms.every((p) => c.permissions.includes(p)) && lacks.every((p) => !c.permissions.includes(p));
    casos.push({ cuenta: `${local} (permisos efectivos por organización)`, resultado: `organizaciones=${perms.organizations.length}; rol ${expected} en Acopio y Cooperativa; mismos permisos en ambas=${!!same}; tiene ${keyPerms.join(', ')}; no tiene ${lacks.join(', ')}=${okPerms}`, ok: okPerms && perms.organizations.length === 2 });
  }
  {
    const a = acc('calidad.acopio');
    if (a) {
      const { ctx, page } = await loginAs(a, { width: 390, height: 844 });
      // cambio de organización: en el Acopio no hay entregas DEMO; en la Cooperativa sí
      await page.goto(`${BASE}/organizaciones/${acopio}/entregas`);
      await page.getByText('Aún no hay entregas a tu alcance.').or(page.getByRole('table', { name: 'Entregas' })).first().waitFor({ timeout: 15000 });
      const acopioEmpty = await page.getByText('Aún no hay entregas a tu alcance.').count();
      await list(page);
      await page.getByRole('row', { name: /DEMO-RV-001/ }).getByRole('link').first().click();
      await page.getByRole('heading', { name: /Entrega ENT-/ }).waitFor({ timeout: 15000 });
      const rec = page.getByRole('article', { name: 'Recepción 1' });
      const receive = await page.getByRole('button', { name: 'Revisar recepción' }).count();
      const before = await rec.innerText();
      // tarea real: registrar un resultado SIN decisión (pendiente de evaluación) sobre la muestra DEMO-M-001, una sola vez
      let registered = before.includes('Diana Pinargote');
      if (!registered) {
        await rec.getByLabel('Método').first().fill('Prueba de corte (revisión DEMO)');
        await rec.getByLabel(/Humedad/).first().fill('7.4');
        await rec.getByRole('button', { name: 'Guardar resultado' }).first().focus();
        await page.keyboard.press('Enter');
        await rec.getByText(/Diana Pinargote/).first().waitFor({ timeout: 15000 });
        registered = true;
      }
      const text = await rec.innerText();
      const stillPending = text.includes('Pendiente de evaluación');
      const decideOption = await rec.getByRole('option', { name: 'Liberar calidad' }).count();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      await page.screenshot({ path: join(shots, 'entregas--calidad-390.png'), fullPage: true });
      casos.push({ cuenta: 'calidad.acopio (390 px, teclado; cambio de organización)', resultado: `Acopio sin entregas=${acopioEmpty === 1}; puede recibir=${receive}; resultado sin decisión registrado=${registered}; sigue «Pendiente de evaluación»=${stillPending}; puede decidir=${decideOption > 0}; desborde=${overflow}`,
        ok: acopioEmpty === 1 && receive === 0 && registered && stillPending && decideOption > 0 && !overflow });
      await ctx.close();
    }
  }
  return { tipo: 'entregas', casos, ok: casos.every((c) => c.ok) };
}
