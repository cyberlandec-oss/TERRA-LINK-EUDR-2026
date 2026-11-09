// A-02 — Demostración en el despliegue: administración web de CONCESIONES (propietario → destinatario → revocación → pérdida de acceso).
//
//   node e2e/review/a02-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Sobre el DEMO ya existente (sintético): propietario = admin.cooperativa (Río Verde), destinatario = comprador.importador (Chocolates Europa,
// NO miembro de Río Verde). Lee CREDENCIALES.csv con la utilidad segura; no imprime contraseñas. No simula aprobaciones ni cambia permisos.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'a02-demostracion-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(92)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(92)} ${String(e.message).slice(0, 220)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 220) }); }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const login = async (cta) => { const c = cuentaDemo(cta); return { token: (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token, email: c.email }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);

const adm = await login('admin.cooperativa'); const rec = await login('comprador.importador'); const tec = await login('tecnico1.cooperativa'); const otra = await login('admin.exportadora');
const orgRV = (await pedir(adm.token, 'GET', '/api/v1/organizations')).b.find((o) => o.name.includes('Río Verde'));
const orgOtra = (await pedir(otra.token, 'GET', '/api/v1/organizations')).b[0];
const B = `/api/v1/organizations/${orgRV.id}`;
const lots = lista((await pedir(adm.token, 'GET', `${B}/lots?limit=100`)).b);
// Limpieza previa: las concesiones ACTIVAS que dejó el recorrido de cadena (T14, 24 h, destinatario sintético) se revocan con motivo para que la lista del destinatario
// contenga solo la de este ensayo (la lista del destinatario no rotula el lote hasta abrirlo). Solo se tocan concesiones de este destinatario sintético.
for (const g of (await pedir(adm.token, 'GET', `${B}/access-grants`)).b.grants.filter((x) => x.estado === 'ACTIVA' && x.grantee_email === rec.email)) {
  await pedir(adm.token, 'POST', `${B}/access-grants/${g.id}/revoke`, { operation_id: randomUUID(), reason: 'Limpieza de concesiones de ensayo previas (recorrido de cadena)' });
}
const lote = lots.filter((l) => l.lot_code).sort((a, b) => b.lot_code.localeCompare(a.lot_code))[0];
const sesion = async (browser, token, lang = 'es', viewport) => { const ctx = await browser.newContext(viewport ? { viewport } : {}); await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); return { ctx, page: await ctx.newPage() }; };
const grantsAdmin = async () => (await pedir(adm.token, 'GET', `${B}/access-grants`)).b.grants;
const misGrants = async () => (await pedir(rec.token, 'GET', '/api/v1/granted')).b.grants;
console.log(`\n== A-02 · ${orgRV.name} · lote ${lote.lot_code} · destinatario ${rec.email.replace(/^[^@]+/, '***')} ==\n`);
const antes = (await grantsAdmin()).length;
const browser = await chromium.launch();
let grantId = null;

await caso('1 El propietario abre Concesiones; el técnico (sin grant:manage) no tiene menú ni acceso', async () => {
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgRV.id}/concesiones`);
  await a.page.getByRole('heading', { name: 'Concesiones', level: 1 }).waitFor();
  const menu = await a.page.getByRole('link', { name: 'Concesiones', exact: true }).count();
  await a.page.getByRole('table', { name: 'Concesiones' }).waitFor({ timeout: 15000 }).catch(() => {});
  const filas = await a.page.locator('table[aria-label="Concesiones"] tbody tr').count();
  await a.page.screenshot({ path: join(SALIDA, '1-lista-propietario.png'), fullPage: true });
  await a.ctx.close();
  const t = await sesion(browser, tec.token); await t.page.goto(`${WEB}/organizaciones/${orgRV.id}/concesiones`);
  const denegado = await t.page.getByText('No tienes permiso para administrar concesiones.').waitFor({ timeout: 10000 }).then(() => true, () => false);
  const menuT = await t.page.getByRole('link', { name: 'Concesiones', exact: true }).count();
  const api = (await pedir(tec.token, 'GET', `${B}/access-grants`)).s;
  await t.ctx.close();
  return [menu === 1 && denegado && menuT === 0 && api === 403, `propietario: menú=${menu}, filas previas=${filas} · técnico: pantalla denegada=${denegado}, menú=${menuT}, API=${api}`];
});

await caso('2 Alta guiada: un correo no identificable da un mensaje único; revisar NO concede; confirmar sí', async () => {
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgRV.id}/concesiones`);
  await a.page.getByLabel('Recurso a compartir').waitFor({ timeout: 15000 });
  const opcion = await a.page.getByLabel('Recurso a compartir').locator('option', { hasText: lote.lot_code }).first().getAttribute('value');
  await a.page.getByLabel('Recurso a compartir').selectOption(opcion);
  await a.page.getByLabel('Correo exacto de la cuenta destinataria').fill('nadie-demo@ensayo.terralink.local');
  await a.page.getByLabel(/^Motivo \(queda en la auditoría\)/).fill('Demostración A-02: revisión del comprador');
  await a.page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  await a.page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  const generico = await a.page.getByText(/No se pudo identificar una cuenta destinataria disponible/).waitFor({ timeout: 10000 }).then(() => true, () => false);
  const trasFallo = (await grantsAdmin()).length;
  await a.page.getByLabel('Correo exacto de la cuenta destinataria').fill(rec.email.toUpperCase());
  await a.page.getByRole('button', { name: 'Revisar antes de otorgar' }).click();
  await a.page.getByText('Revisa antes de otorgar (todavía no se concedió nada)').waitFor();
  const trasRevisar = (await grantsAdmin()).length;
  await a.page.screenshot({ path: join(SALIDA, '2-revision.png'), fullPage: true });
  await a.page.getByRole('button', { name: 'Confirmar y otorgar' }).click();
  await a.page.getByText(/Concesión otorgada/).waitFor({ timeout: 15000 });
  const g = (await grantsAdmin()).find((x) => x.grantee_email === rec.email && x.estado === 'ACTIVA' && x.resource_label === lote.lot_code);
  grantId = g?.id;
  await a.page.screenshot({ path: join(SALIDA, '2-otorgada.png'), fullPage: true });
  await a.ctx.close();
  return [generico && trasFallo === antes && trasRevisar === antes && !!g && g.can_read && !g.can_download, `mensaje único=${generico} · concesiones tras fallo/revisión=${trasFallo}/${trasRevisar} (antes ${antes}) · tras confirmar: ACTIVA, solo lectura=${!!g}`];
});

await caso('3 El destinatario (no miembro) ve solo lo concedido: proyección sin identidad ni geometrías; el espacio de la cooperativa le responde 404', async () => {
  const r = await sesion(browser, rec.token); await r.page.goto(`${WEB}/compartido`);
  await r.page.getByRole('button', { name: 'Ver', exact: true }).first().waitFor({ timeout: 15000 });
  await r.page.getByRole('button', { name: 'Ver', exact: true }).first().click();
  await r.page.getByText(lote.lot_code).first().waitFor({ timeout: 15000 });
  await r.page.screenshot({ path: join(SALIDA, '3-destinatario.png'), fullPage: true });
  const cuerpo = await r.page.locator('main').innerText(); await r.ctx.close();
  const proy = (await pedir(rec.token, 'GET', `/api/v1/granted/${grantId}`)).b;
  const texto = JSON.stringify(proy);
  const directo = [(await pedir(rec.token, 'GET', `${B}/lots/${lote.id}`)).s, (await pedir(rec.token, 'GET', `${B}/access-grants`)).s, (await pedir(rec.token, 'GET', `${B}/plots`)).s];
  return [!/Quijije|Zambrano|DEMO-RV-/.test(cuerpo) && !/coordinates|legal_name|document_number|precio|price/i.test(texto) && directo.every((s) => s === 404 || s === 403) && proy?.resource_type === 'LOT',
    `sin identidad ni geometrías ni economía · acceso directo (lote/concesiones/parcelas)=${directo.join('/')}`];
});

await caso('4 Rechazos: recurso de otra organización, otra administración sin acceso y destinatario sin vencimiento válido', async () => {
  const ajeno = await pedir(adm.token, 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: rec.email, resource_type: 'LOT', resource_id: randomUUID(), expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Recurso inexistente/ajeno' });
  const otraLista = (await pedir(otra.token, 'GET', `/api/v1/organizations/${orgRV.id}/access-grants`)).s;
  const otraRevoca = (await pedir(otra.token, 'POST', `/api/v1/organizations/${orgRV.id}/access-grants/${grantId}/revoke`, { operation_id: randomUUID(), reason: 'Intento ajeno' })).s;
  const suyas = (await pedir(otra.token, 'GET', `/api/v1/organizations/${orgOtra.id}/access-grants`)).b?.grants?.map((x) => x.id) ?? [];
  const pasado = await pedir(adm.token, 'POST', `${B}/access-grants`, { operation_id: randomUUID(), grantee_email: rec.email, resource_type: 'LOT', resource_id: lote.id, expires_at: new Date(Date.now() - 1000).toISOString(), reason: 'Vencimiento pasado' });
  return [ajeno.s === 422 && [403, 404].includes(otraLista) && otraRevoca === 404 && !suyas.includes(grantId) && pasado.s === 422,
    `recurso ajeno=${ajeno.s} ${ajeno.b?.error?.code} · otra administración: lista=${otraLista}, revocar=${otraRevoca}, ve la concesión=${suyas.includes(grantId)} · vencimiento pasado=${pasado.s} ${pasado.b?.error?.code}`];
});

await caso('5 El propietario revoca con motivo (la interfaz no confirma sin él) y el destinatario pierde el acceso al instante', async () => {
  const a = await sesion(browser, adm.token); await a.page.goto(`${WEB}/organizaciones/${orgRV.id}/concesiones`);
  const fila = a.page.locator('table[aria-label="Concesiones"] tbody tr').filter({ hasText: lote.lot_code }).filter({ hasText: 'Activa' }).first();
  await fila.getByRole('button', { name: 'Revocar', exact: true }).click();
  const sinMotivo = await a.page.getByRole('button', { name: 'Confirmar revocación' }).isDisabled();
  await a.page.getByLabel('Motivo de la revocación').fill('Fin de la demostración A-02');
  await a.page.getByRole('button', { name: 'Confirmar revocación' }).click();
  await a.page.getByText('Concesión revocada: el destinatario ya no tiene acceso.').waitFor({ timeout: 15000 });
  await a.page.getByRole('button', { name: /^Revocada/ }).click();
  await a.page.screenshot({ path: join(SALIDA, '5-revocada.png'), fullPage: true });
  await a.ctx.close();
  const g = (await grantsAdmin()).find((x) => x.id === grantId);
  const sigue = (await misGrants()).some((x) => x.id === grantId);
  const lee = (await pedir(rec.token, 'GET', `/api/v1/granted/${grantId}`)).s;
  const r = await sesion(browser, rec.token); await r.page.goto(`${WEB}/compartido`); await r.page.waitForTimeout(3000);
  const ver = await r.page.getByRole('button', { name: 'Ver', exact: true }).count(); await r.ctx.close();
  return [sinMotivo && g?.estado === 'REVOCADA' && g.revoke_reason === 'Fin de la demostración A-02' && !!g.revoked_by_name && !sigue && lee === 404 && ver === 0,
    `botón sin motivo deshabilitado=${sinMotivo} · estado=${g?.estado}, motivo y responsable registrados · destinatario: en su lista=${sigue}, lectura=${lee}, botones Ver=${ver}`];
});

await caso('6 Auditoría: conceder, rechazar destinatario y revocar quedan registrados sin el correo en claro', async () => {
  const q = "select action, count(*) from audit_logs where organization_id = '" + orgRV.id + "' and action in ('grant.create','grant.revoke','grant.recipient_unavailable') and occurred_at > now() - interval '30 minutes' group by 1 order by 1";
  const out = execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-tAc', q], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim().split('\n');
  const claro = execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-tAc', "select count(*) from audit_logs where action = 'grant.recipient_unavailable' and after::text like '%nadie-demo%'"], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();
  return [out.some((l) => l.startsWith('grant.create')) && out.some((l) => l.startsWith('grant.revoke')) && out.some((l) => l.startsWith('grant.recipient_unavailable')) && claro === '0', `filas: ${out.join(' · ')} · correo en claro en auditoría=${claro}`];
});

await caso('7 Inglés y 390 px con teclado: mismo recorrido traducido, sin desborde', async () => {
  const e = await sesion(browser, adm.token, 'en', { width: 390, height: 844 }); await e.page.goto(`${WEB}/organizaciones/${orgRV.id}/concesiones`);
  await e.page.getByRole('heading', { name: 'Grants', level: 1 }).waitFor();
  await e.page.getByLabel('Resource to share').waitFor({ timeout: 15000 });
  await e.page.getByLabel('Resource to share').selectOption({ index: 1 });
  await e.page.getByLabel('Exact email of the recipient account').fill(rec.email);
  await e.page.getByLabel(/^Reason \(kept in the audit trail\)/).fill('English review (demo)');
  const previas = (await grantsAdmin()).length;
  await e.page.getByRole('button', { name: 'Review before granting' }).focus(); await e.page.keyboard.press('Enter');
  await e.page.getByText('Review before granting (nothing has been granted yet)').waitFor();
  const cuerpo = await e.page.locator('main').innerText();
  const ok = await e.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await e.page.screenshot({ path: join(SALIDA, '7-ingles-390px.png'), fullPage: true });
  const nuevas = (await grantsAdmin()).length;
  await e.ctx.close();
  return [ok && !/\b[a-z]+\.[a-z_]+\.[a-z_]+\b/.test(cuerpo.replace(/\S+@\S+/g, '')) && nuevas === previas, `sin desborde=${ok} · sin claves de traducción · revisar no concedió nada (concesiones ${previas} → ${nuevas})`];
});

await browser.close();
const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ lote: lote.lot_code, casos: resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones OK${fallas ? ` · ${fallas} FALLAN` : ''}`);
process.exit(fallas ? 1 : 0);
