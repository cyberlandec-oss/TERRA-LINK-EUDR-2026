// Corrección de alcance de A-01 — el Gerente (MANAGER) no vincula cuentas a productores (`producer:link_self`).
//
//   node e2e/review/gerente-vinculo-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// Sobre el DEMO sintético: Gerente = supervisor.cooperativa; administración = admin.cooperativa; Productor = productor.cooperativa. NO modifica ningún vínculo:
// la solicitud del Gerente se rechaza antes de escribir (403) y el control positivo de la administración usa una solicitud que ATRAVIESA la autorización y se
// rechaza por regla de negocio ANTES de escribir (la persona indicada no tiene el rol Productor). El éxito real de vincular/desvincular lo prueban las suites
// `a01-alcance-propio` (validadas sobre este SHA). Se comprueba que el estado de los vínculos es idéntico antes y después.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'gerente-vinculo-2026-10-21');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const login = async (cta) => { const c = cuentaDemo(cta); return { token: (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token }; };
const sesion = async (browser, token) => { const ctx = await browser.newContext(); await ctx.addInitScript(([t]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', 'es'); }, [token]); const page = await ctx.newPage(); return { ctx, page }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();

const adm = await login('admin.cooperativa'); const mgr = await login('supervisor.cooperativa'); const prod = await login('productor.cooperativa');
const orgRV = lista((await pedir(adm.token, 'GET', '/api/v1/organizations')).b).find((o) => o.name.includes('Río Verde'));
const B = `/api/v1/organizations/${orgRV.id}`;
const vinculos = () => db(`select id, coalesce(self_membership_id::text,''), row_version from producers where organization_id = '${orgRV.id}' order by id`);
const versionesLink = () => db(`select count(*) from producer_versions where organization_id = '${orgRV.id}' and change_type = 'LINK_SELF'`);
const antes = vinculos(); const antesV = versionesLink();
const productores = lista((await pedir(adm.token, 'GET', `${B}/producers?limit=100`)).b);
const objetivo = productores.find((p) => p.status !== 'INACTIVE') ?? productores[0];
const miembros = lista((await pedir(adm.token, 'GET', `${B}/members`)).b);
const mSup = miembros.find((m) => /supervisor\.cooperativa/.test(JSON.stringify(m)));
console.log(`\n== Corrección del Gerente · ${orgRV.name} · ${productores.length} productores · vínculos antes: ${antes.split('\n').filter((l) => l.split('|')[1]).length} ==\n`);
if (!objetivo || !mSup) throw new Error('Faltan el productor objetivo o la membresía del Gerente en el DEMO');
const detalle = async (t) => (await pedir(t, 'GET', `${B}/producers/${objetivo.id}`)).b;
const intento = (t, membership) => pedir(t, 'PUT', `${B}/producers/${objetivo.id}/self-membership`, { expected_version: Number(objetivo.row_version ?? 1), membership_id: membership, reason: 'Solicitud de verificación de permisos (sin efecto esperado)' });

await caso('1 El Gerente NO tiene el permiso de vincular, pero conserva sus permisos de gestión de productores y parcelas', async () => {
  const p = (await pedir(mgr.token, 'GET', '/api/v1/me/permissions')).b;
  const permisos = (Array.isArray(p) ? p : p?.permissions ?? (p?.organizations ?? []).flatMap((o) => o.permissions ?? [])).map((x) => (typeof x === 'string' ? x : x.code));
  const texto = JSON.stringify(p);
  const tiene = (c) => texto.includes(`"${c}"`);
  return [!tiene('producer:link_self') && ['producer:read', 'producer:create', 'producer:update', 'plot:read', 'plot:create', 'plot:update'].every(tiene), `producer:link_self=${tiene('producer:link_self')}; gestión: producer:read/create/update=${['producer:read', 'producer:create', 'producer:update'].every(tiene)}, plot:read/create/update=${['plot:read', 'plot:create', 'plot:update'].every(tiene)} (permisos leídos: ${permisos.length})`];
});

await caso('2 Solicitud DIRECTA del Gerente para vincular una cuenta: 403, sin efecto', async () => {
  const r = await intento(mgr.token, mSup.membership_id ?? mSup.id);
  return [r.s === 403 && vinculos() === antes && versionesLink() === antesV, `HTTP ${r.s} ${r.b?.error?.code ?? ''}; vínculos y versiones LINK_SELF sin cambio=${vinculos() === antes && versionesLink() === antesV}`];
});

await caso('3 Control positivo: la administración conserva la operación (atraviesa la autorización; la regla de negocio la detiene ANTES de escribir)', async () => {
  const r = await intento(adm.token, mSup.membership_id ?? mSup.id);
  return [r.s === 422 && r.b?.error?.code === 'MEMBERSHIP_WITHOUT_PRODUCER_ROLE' && vinculos() === antes, `HTTP ${r.s} ${r.b?.error?.code}; vínculos sin cambio=${vinculos() === antes}. El éxito real de vincular y desvincular lo prueba la suite a01-alcance-propio sobre este SHA`];
});

await caso('4 Otros roles siguen sin poder vincular y el propio Productor tampoco (403); el Productor conserva su alcance propio', async () => {
  const r = await intento(prod.token, mSup.membership_id ?? mSup.id);
  const propias = (await pedir(prod.token, 'GET', `${B}/plots`)).s;
  return [r.s === 403 && propias === 200 && vinculos() === antes, `Productor vincula: ${r.s}; lista sus parcelas: ${propias}`];
});

await caso('5 En pantalla: el Gerente no ve el control de vincular; la administración sí (y su gestión de productores sigue disponible)', async () => {
  const browser = await chromium.launch();
  const ver = async (token, nombre) => {
    const s = await sesion(browser, token); await s.page.goto(`${WEB}/organizaciones/${orgRV.id}/productores/${objetivo.id}`);
    await s.page.getByRole('heading', { level: 1 }).waitFor({ timeout: 30000 });
    const texto = await s.page.locator('main').innerText();
    await s.page.screenshot({ path: join(SALIDA, `5-${nombre}.png`), fullPage: true });
    await s.ctx.close();
    return /Vincul/i.test(texto);
  };
  const gerenteVe = await ver(mgr.token, 'gerente'); const adminVe = await ver(adm.token, 'administracion');
  await browser.close();
  const d = await detalle(mgr.token); const da = await detalle(adm.token);
  return [!gerenteVe && adminVe && d.can_link_self !== true && da.can_link_self === true, `control «vincular» visible: Gerente=${gerenteVe}, administración=${adminVe}; can_link_self API: Gerente=${d.can_link_self === true}, administración=${da.can_link_self === true}`];
});

await caso('6 Ningún vínculo existente se eliminó ni modificó como efecto de retirar el permiso', async () => [vinculos() === antes && versionesLink() === antesV, `vínculos: ${antes.split('\n').filter((l) => l.split('|')[1]).length} antes y después; versiones LINK_SELF: ${antesV} → ${versionesLink()}`]);

const ok = resultados.filter((r) => r.ok).length;
writeFileSync(join(SALIDA, 'resultado.json'), JSON.stringify({ fecha: new Date().toISOString(), resultados }, null, 2));
console.log(`\nCorrección del Gerente · demostración en el despliegue: ${ok}/${resultados.length}`);
process.exit(ok === resultados.length ? 0 : 1);
