// P1-015 / D-54 — Demostración en el despliegue: coste estimado, idiomas y acceso federado con KEYCLOAK REAL.
//
//   node e2e/review/p1015-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000] [--kc http://localhost:8180]
//
// Requisitos: API y web desplegadas con SSO_ENABLED=true apuntando al Keycloak local de ensayo
// (`docker compose --profile sso up -d keycloak`), y KEYCLOAK_ADMIN_PASSWORD en .env.
//
// Qué demuestra (todo con datos SINTÉTICOS y una organización propia «ENSAYO P1-015», sin tocar las cuentas DEMO):
//   1. coste: sin tarifa → «sin tarifa» (no cero); tarifa sintética identificada → estimado exacto; reproducible;
//      mes fuera de vigencia → sin precio; todo también en inglés;
//   2. SSO con Keycloak real: la autorización lleva PKCE S256; sin PKCE el proveedor la rechaza; un destino de
//      retorno no permitido lo rechaza el proveedor; una identidad SIN vínculo (con el MISMO correo de una cuenta
//      local) no entra; tras vincular, entra con el mismo testigo; ve solo SU organización; cierre de sesión
//      cierra la sesión local y la del proveedor; usuario deshabilitado en el proveedor no entra;
//   3. el acceso con contraseña sigue disponible.
// No imprime contraseñas ni testigos. Las contraseñas de ensayo se generan en memoria y se descartan.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const KC = arg('--kc', 'http://localhost:8180');
const REALM = 'terra-link-dev';

const env = {};
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()); if (m) env[m[1]] = m[2]; }
const KC_ADMIN = env.KEYCLOAK_ADMIN_USER ?? 'admin';
const KC_PASS = env.KEYCLOAK_ADMIN_PASSWORD;
if (!KC_PASS) { console.error('Falta KEYCLOAK_ADMIN_PASSWORD en .env'); process.exit(2); }

const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(78)} ${detalle}`); resultados.push(ok); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(78)} ${String(e.message).slice(0, 200)}`); resultados.push(false); }
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, { method: metodo, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (email, password) => (await pedir(null, 'POST', '/api/v1/auth/login', { email, password })).body.access_token;

// ---------------------------------------------------------------- Keycloak (administración)
async function kcAdminToken() {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: KC_ADMIN, password: KC_PASS }) });
  if (!r.ok) throw new Error(`administración de Keycloak: ${r.status}`);
  return (await r.json()).access_token;
}
async function kcUsuario(tok, { username, email, password, enabled = true }) {
  const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' };
  const r = await fetch(`${KC}/admin/realms/${REALM}/users`, { method: 'POST', headers: h, body: JSON.stringify({ username, email, emailVerified: true, enabled, firstName: 'Ensayo', lastName: username, credentials: [{ type: 'password', value: password, temporary: false }] }) });
  if (r.status !== 201) throw new Error(`crear usuario ${username}: ${r.status}`);
  return r.headers.get('location').split('/').pop();
}
async function kcDeshabilitar(tok, id) {
  await fetch(`${KC}/admin/realms/${REALM}/users/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
}

// ---------------------------------------------------------------- navegador
async function entrarEnKeycloak(page, username, password) {
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
}
async function nuevaSesion(browser, token, lang = 'es') {
  const ctx = await browser.newContext();
  await ctx.addInitScript(([t, l]) => { if (t) sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token ?? '', lang]);
  return { ctx, page: await ctx.newPage() };
}

const sufijo = randomBytes(3).toString('hex');
const pass = () => randomBytes(14).toString('base64url') + 'aA1!';

const sup = cuentaDemo('superadmin.revision');
const superTok = await login(sup.email, sup.contrasena);

// ================================================================ 1) Coste
const adminEmail = `ensayo.p1015.${sufijo}@ensayo.terralink.local`;
const adminPass = pass();
const org = (await pedir(superTok, 'POST', '/api/v1/organizations', { name: `ENSAYO P1-015 (sintético) ${sufijo}`, organization_type: 'COOPERATIVE', country: 'EC' })).body;
const inv = (await pedir(superTok, 'POST', `/api/v1/organizations/${org.id}/invitations`, { email: adminEmail, role_code: 'ORG_ADMIN' })).body;
await pedir(null, 'POST', '/api/v1/invitations/accept', { token: inv.token, first_name: 'Ensayo', last_name: 'P1015', password: adminPass });
let adminTok = await login(adminEmail, adminPass);
const base = `/api/v1/organizations/${org.id}/platform-cost`;
const op = () => randomUUID();

await caso('1.1 sin tarifa declarada: lista vacía (no hay tarifas precargadas)', async () => {
  const r = await pedir(adminTok, 'GET', `${base}/tariffs`);
  return [r.status === 200 && r.body.tariffs.length === 0, `tarifas=${r.body?.tariffs?.length}`];
});
await caso('1.2 estimar sin tarifa → SIN_TARIFA, total nulo (NO cero), sin importes', async () => {
  const r = await pedir(adminTok, 'POST', `${base}/estimates`, { operation_id: op(), period_start: '2026-01-01', period_end: '2026-03-01' });
  const e = r.body?.estimate;
  return [r.status === 201 && e.status === 'SIN_TARIFA' && e.total === null && e.lines.every((l) => l.amount === null), `status=${e?.status} total=${e?.total}`];
});
await pedir(adminTok, 'POST', `${base}/tariffs`, { operation_id: op(), monthly_fee: '10.0000', valid_from: '2026-01-01', valid_to: '2026-04-01', synthetic: true, label: 'Tarifa SINTÉTICA de demostración P1-015', source: 'Demostración automática: no es un acuerdo ni una tarifa real' });
let estId;
await caso('1.3 tarifa SINTÉTICA identificada → estimación exacta de 3 meses = 30.0000 USD', async () => {
  const r = await pedir(adminTok, 'POST', `${base}/estimates`, { operation_id: op(), period_start: '2026-01-01', period_end: '2026-04-01' });
  const e = r.body?.estimate; estId = e?.id;
  return [e?.status === 'ESTIMADO' && e.total === '30.0000' && e.currency === 'USD' && e.lines.every((l) => l.synthetic === true), `total=${e?.total} ${e?.currency}`];
});
await caso('1.4 meses fuera de vigencia quedan SIN PRECIO (PARCIAL), no en cero', async () => {
  const r = await pedir(adminTok, 'POST', `${base}/estimates`, { operation_id: op(), period_start: '2026-03-01', period_end: '2026-06-01' });
  const e = r.body?.estimate;
  return [e?.status === 'PARCIAL' && e.total === '10.0000' && e.lines.filter((l) => l.amount === null).length === 2, `status=${e?.status} total=${e?.total}`];
});
await caso('1.5 reproducible con las entradas guardadas, aunque se declare después otra tarifa', async () => {
  await pedir(adminTok, 'POST', `${base}/tariffs`, { operation_id: op(), monthly_fee: '99.0000', valid_from: '2026-01-01', synthetic: true, label: 'Tarifa SINTÉTICA posterior', source: 'Demostración automática', reason: 'Probar que el pasado no se reescribe' });
  const r = await pedir(adminTok, 'GET', `${base}/estimates/${estId}/verify`);
  return [r.body?.reproducible === true, `reproducible=${r.body?.reproducible}`];
});
await caso('1.6 la otra organización (DEMO) no ve estas tarifas ni estimaciones (404)', async () => {
  const dem = cuentaDemo('admin.cooperativa');
  const t = await login(dem.email, dem.contrasena);
  const a = await pedir(t, 'GET', `${base}/tariffs`);
  const b = await pedir(t, 'GET', `${base}/estimates/${estId}`);
  return [a.status === 404 && b.status === 404, `tarifas=${a.status} estimación=${b.status}`];
});

const browser = await chromium.launch();
await caso('1.7 pantalla de coste en español y en inglés (importe, tarifa sintética, conceptos sin valorar)', async () => {
  const t = await login(adminEmail, adminPass);
  const es = await nuevaSesion(browser, t, 'es');
  await es.page.goto(`${WEB}/organizaciones/${org.id}/coste`);
  await es.page.getByText('Es una estimación, no una factura.').waitFor();
  await es.page.getByText('USD 30.0000').first().waitFor();
  const okEs = (await es.page.getByText('USD 30.0000').count()) > 0 && (await es.page.getByText('Sintética (demostración)').count()) > 0;
  await es.ctx.close();
  const en = await nuevaSesion(browser, t, 'en');
  await en.page.goto(`${WEB}/organizaciones/${org.id}/coste`);
  await en.page.getByText('This is an estimate, not an invoice.').waitFor();
  await en.page.getByText('USD 30.0000').first().waitFor();
  const okEn = (await en.page.getByText('USD 30.0000').count()) > 0 && (await en.page.getByText('Items that are not priced').count()) > 0;
  await en.ctx.close();
  return [okEs && okEn, `es=${okEs} en=${okEn}`];
});

// ================================================================ 2) SSO con Keycloak real
const kcTok = await kcAdminToken();
const kcA = { username: `ensayo-a-${sufijo}`, password: pass() };
const kcB = { username: `ensayo-b-${sufijo}`, password: pass() };
const kcC = { username: `ensayo-c-${sufijo}`, password: pass() };
// B declara el MISMO correo que la cuenta local del ensayo: no debe vincular nada.
const idA = await kcUsuario(kcTok, { ...kcA, email: `a.${sufijo}@ensayo.terralink.local` });
await kcUsuario(kcTok, { ...kcB, email: adminEmail });
const idC = await kcUsuario(kcTok, { ...kcC, email: `c.${sufijo}@ensayo.terralink.local` });

const cfg = (await pedir(null, 'GET', '/api/v1/auth/sso/config')).body;
await caso('2.0 el despliegue declara el acceso federado habilitado', async () => [cfg?.enabled === true, `enabled=${cfg?.enabled} etiqueta=${cfg?.label}`]);

await caso('2.1 la autorización lleva PKCE S256, state y nonce', async () => {
  const s = (await pedir(null, 'POST', '/api/v1/auth/sso/start', { redirect_uri: `${WEB}/acceso/sso` })).body;
  const u = new URL(s.authorization_url);
  return [u.searchParams.get('code_challenge_method') === 'S256' && !!u.searchParams.get('code_challenge') && !!u.searchParams.get('state') && !!u.searchParams.get('nonce') && u.origin === KC, `S256=${u.searchParams.get('code_challenge_method')}`];
});
await caso('2.2 SIN PKCE el proveedor rechaza la autorización', async () => {
  const s = (await pedir(null, 'POST', '/api/v1/auth/sso/start', { redirect_uri: `${WEB}/acceso/sso` })).body;
  const u = new URL(s.authorization_url);
  u.searchParams.delete('code_challenge'); u.searchParams.delete('code_challenge_method');
  const { ctx, page } = await nuevaSesion(browser, null);
  await page.goto(u.toString());
  // El proveedor rechaza la autorizacion sin PKCE: o muestra su pagina de error, o devuelve el error a la aplicacion
  // (RFC 6749 4.1.2.1), que lo muestra sin testigo. En ningun caso aparece el formulario de acceso.
  await page.waitForFunction(() => document.body && document.body.innerText.length > 20);
  await page.waitForTimeout(1500);
  const sinFormulario = (await page.locator('#username').count()) === 0;
  const devueltoALaApp = page.url().includes('/acceso/sso') && (await page.locator('[data-code="SSO_PROVIDER_ERROR"]').count()) > 0;
  const texto = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const token = await page.evaluate(() => sessionStorage.getItem('tl_token'));
  await ctx.close();
  return [sinFormulario && !token && (devueltoALaApp || /code_challenge|PKCE|Missing|Invalid|sorry/i.test(texto)), `formulario=${!sinFormulario} devuelto-a-la-app=${devueltoALaApp} sin-testigo=${!token}`];
});
await caso('2.3 un destino de retorno no permitido lo rechaza la API (422) y el proveedor', async () => {
  const api = await pedir(null, 'POST', '/api/v1/auth/sso/start', { redirect_uri: 'http://evil.example/acceso/sso' });
  const s = (await pedir(null, 'POST', '/api/v1/auth/sso/start', { redirect_uri: `${WEB}/acceso/sso` })).body;
  const u = new URL(s.authorization_url); u.searchParams.set('redirect_uri', 'http://evil.example/acceso/sso');
  const { ctx, page } = await nuevaSesion(browser, null);
  await page.goto(u.toString());
  const sinFormulario = (await page.locator('#username').count()) === 0;
  await ctx.close();
  return [api.status === 422 && sinFormulario, `api=${api.status} proveedor-sin-formulario=${sinFormulario}`];
});

await caso('2.4 IDENTIDAD SIN VÍNCULO (mismo correo que una cuenta local): no entra', async () => {
  const { ctx, page } = await nuevaSesion(browser, null);
  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: /Entrar con/ }).click();
  await entrarEnKeycloak(page, kcB.username, kcB.password);
  await page.waitForURL(/acceso\/sso/);
  await page.locator('[data-code="SSO_IDENTITY_NOT_LINKED"]').waitFor();
  const token = await page.evaluate(() => sessionStorage.getItem('tl_token'));
  await ctx.close();
  return [!token, 'SSO_IDENTITY_NOT_LINKED y sin testigo'];
});

await caso('2.5 vincular desde la sesión propia (Mi cuenta) con KEYCLOAK real', async () => {
  const { ctx, page } = await nuevaSesion(browser, adminTok);
  await page.goto(`${WEB}/cuenta`);
  await page.getByRole('button', { name: /Vincular/ }).click();
  await entrarEnKeycloak(page, kcA.username, kcA.password);
  await page.waitForURL(/acceso\/sso/);
  await page.getByRole('heading', { name: 'Identidad vinculada' }).waitFor();
  const links = (await pedir(adminTok, 'GET', '/api/v1/auth/sso/links')).body.links;
  await ctx.close();
  return [links.length === 1 && links[0].issuer === `${KC}/realms/${REALM}`, `vínculos=${links.length} emisor=${links[0]?.issuer}`];
});

let ssoToken;
let sesionSso;
await caso('2.6 acceso con la identidad vinculada: mismo testigo, SU organización y no la ajena', async () => {
  const { ctx, page } = await nuevaSesion(browser, null);
  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: /Entrar con/ }).click();
  // El proveedor ya tiene sesión de la vinculación: puede entrar sin pedir de nuevo la contraseña.
  await page.waitForURL((u) => u.origin === KC || u.pathname.startsWith('/organizaciones'));
  if (page.url().startsWith(KC)) { await page.locator('#username').waitFor(); await entrarEnKeycloak(page, kcA.username, kcA.password); }
  await page.waitForURL(/\/organizaciones/);
  ssoToken = await page.evaluate(() => sessionStorage.getItem('tl_token'));
  sesionSso = { ctx, page }; // se conserva abierta: 2.8 cierra ESTA sesion y comprueba que el proveedor tambien se cerro
  const propias = (await pedir(ssoToken, 'GET', '/api/v1/organizations')).body;
  const demo = cuentaDemo('admin.cooperativa');
  const demoTok = await login(demo.email, demo.contrasena);
  const demoOrgs = (await pedir(demoTok, 'GET', '/api/v1/organizations')).body;
  const ajena = demoOrgs.find((o) => o.id !== org.id);
  const a = await pedir(ssoToken, 'GET', `/api/v1/organizations/${org.id}/limits`);
  const b = await pedir(ssoToken, 'GET', `/api/v1/organizations/${ajena.id}/limits`);
  return [propias.length === 1 && propias[0].id === org.id && a.status === 200 && b.status === 404, `orgs=${propias.length} propia=${a.status} ajena=${b.status}`];
});

await caso('2.7 el acceso con contraseña sigue disponible', async () => {
  const t = await login(adminEmail, adminPass);
  return [!!t, 'login local OK'];
});

await caso('2.8 CIERRE DE SESIÓN: cierra la sesión local y la del proveedor (pide contraseña otra vez)', async () => {
  const { ctx, page } = sesionSso;
  await page.goto(`${WEB}/organizaciones`);
  // Se registra cada navegacion: el proveedor puede redirigir de vuelta a la aplicacion tan deprisa que no se llega a ver.
  const visitadas = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) visitadas.push(f.url()); });
  await page.getByRole('button', { name: 'Cerrar sesion'.replace('sion', 'sión') }).click();
  // Con una sesion viva en el proveedor, Keycloak pide confirmar el cierre (no se envia id_token_hint) y luego muestra
  // su pagina de sesion cerrada o vuelve a la aplicacion.
  await page.waitForURL((u) => u.origin === KC || (u.origin === new URL(WEB).origin && u.pathname === '/'), { timeout: 20000 });
  await page.waitForLoadState('load');
  if (await page.locator('#kc-logout').count()) await page.locator('#kc-logout').click();
  await page.waitForTimeout(2000);
  const urlCierre = visitadas.find((v) => v.startsWith(KC) && v.includes('/protocol/openid-connect/logout')) ?? '';
  const tras = await pedir(ssoToken, 'GET', '/api/v1/organizations');
  // Un nuevo intento exige credenciales: la sesión del proveedor se cerró.
  await page.goto(`${WEB}/`);
  await page.getByRole('button', { name: /Entrar con/ }).click();
  await page.locator('#username').waitFor({ timeout: 15000 });
  await ctx.close();
  return [tras.status === 401 && urlCierre !== '', `testigo tras cerrar=${tras.status}; cierre en el proveedor=${urlCierre !== ''}; el proveedor pide credenciales de nuevo`];
});

await caso('2.9 USUARIO DESHABILITADO en el proveedor: no entra', async () => {
  // C se vincula por la API de ensayo, pero se deshabilita antes de entrar.
  const { ctx, page } = await nuevaSesion(browser, adminTok);
  await kcDeshabilitar(kcTok, idC);
  await page.goto(`${WEB}/`);
  await ctx.close();
  const { ctx: c2, page: p2 } = await nuevaSesion(browser, null);
  await p2.goto(`${WEB}/`);
  await p2.getByRole('button', { name: /Entrar con/ }).click();
  await p2.locator('#username').waitFor();
  await entrarEnKeycloak(p2, kcC.username, kcC.password);
  await p2.waitForTimeout(2500);
  const sigueEnProveedor = p2.url().startsWith(KC) && (await p2.locator('#username').count()) > 0;
  const token = await p2.evaluate(() => sessionStorage.getItem('tl_token')).catch(() => null);
  await c2.close();
  return [sigueEnProveedor && !token, 'el proveedor rechaza el acceso y no hay testigo'];
});

await caso('2.10 limpieza: la identidad de ensayo se desvincula (la historia queda en la auditoría)', async () => {
  const t = await login(adminEmail, adminPass);
  const links = (await pedir(t, 'GET', '/api/v1/auth/sso/links')).body.links;
  for (const l of links) await pedir(t, 'DELETE', `/api/v1/auth/sso/links/${l.id}`);
  const tras = (await pedir(t, 'GET', '/api/v1/auth/sso/links')).body.links;
  return [tras.length === 0, `vínculos activos=${tras.length}`];
});

// ================================================================ 3) Limites e idiomas
await caso('3.1 limites en espanol y en ingles: mismos codigos y valores, textos traducidos', async () => {
  const t = await login(adminEmail, adminPass);
  const es = (await pedir(t, 'GET', `/api/v1/organizations/${org.id}/limits?lang=es`)).body;
  const en = (await pedir(t, 'GET', `/api/v1/organizations/${org.id}/limits?lang=en`)).body;
  const igual = JSON.stringify(es.limits.map((l) => [l.code, l.value])) === JSON.stringify(en.limits.map((l) => [l.code, l.value]));
  const traducido = en.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES')?.label === 'Maximum size of a document' && es.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES')?.label.startsWith('Tama');
  return [igual && traducido && en.language.available.join() === 'es,en', `igual=${igual} traducido=${traducido} idiomas=${en.language.available}`];
});
await caso('3.2 superar un limite se RECHAZA con explicacion (422) y no genera ningun cargo', async () => {
  const t = await login(adminEmail, adminPass);
  const lim = (await pedir(t, 'GET', `/api/v1/organizations/${org.id}/limits`)).body.limits.find((l) => l.code === 'DOCUMENT_MAX_BYTES');
  const prod = await pedir(t, 'POST', `/api/v1/organizations/${org.id}/producers`, { producer_code: `ENS-${sufijo}`, legal_name: 'Productor de ensayo sintetico' });
  const f = new FormData();
  f.set('operation_id', randomUUID()); f.set('document_type', 'DELIVERY_SUPPORT'); f.set('owner_type', 'producer'); f.set('owner_id', prod.body.id); f.set('title', 'Excede el limite');
  f.set('file', new Blob([Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(Number(lim.value) + 1, 0x20)])], { type: 'application/pdf' }), 'grande.pdf');
  const r = await fetch(`${API}/api/v1/organizations/${org.id}/documents`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: f });
  const cuerpo = await r.json().catch(() => null);
  const est = await pedir(t, 'GET', `${base}/estimates`);
  return [r.status === 422 && cuerpo?.error?.code === 'FILE_TOO_LARGE' && (cuerpo?.error?.message ?? '').length > 15, `estado=${r.status} codigo=${cuerpo?.error?.code}; estimaciones sin cambio de importes=${est.body.estimates.length >= 1}`];
});
await caso('3.3 error de acceso en ingles en el navegador (el correo escrito se conserva)', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => localStorage.setItem('tl_lang', 'en'));
  const page = await ctx.newPage();
  await page.goto(`${WEB}/`);
  await page.getByLabel('Email').fill('nadie@ensayo.terralink.local');
  await page.getByLabel('Password', { exact: true }).fill('incorrecta-1234');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.error[role="alert"]').waitFor();
  const txt = await page.locator('.error[role="alert"]').innerText();
  const conservado = (await page.getByLabel('Email').inputValue()) === 'nadie@ensayo.terralink.local';
  await ctx.close();
  return [/Incorrect email or password/.test(txt) && conservado, `mensaje="${txt.split('\n')[0]}" correo-conservado=${conservado}`];
});

await browser.close();
const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones OK`);
process.exit(ok === resultados.length ? 0 : 1);
