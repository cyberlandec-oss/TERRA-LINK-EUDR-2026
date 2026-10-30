// QA por cuenta y contexto (2026-10-30) — PARTE A: matriz de TODAS las cuentas del archivo de credenciales vigente.
//   node e2e/review/qa-cuentas-matriz.mjs [--web http://localhost:3000] [--base http://localhost:4000]
// Por cada cuenta + organización activa: inicio de sesión, permisos efectivos del servidor frente al catálogo de roles, menú observado frente al esperado por permisos,
// una lectura permitida (200) y sondeos PROHIBIDOS con cuerpo válido (403/404) sin efecto sobre los datos. No crea cuentas, no cambia claves, no escribe datos
// (los sondeos prohibidos deben ser rechazados; se comprueban los recuentos antes y después). No imprime contraseñas ni testigos.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'qa-integral-2026-10-30');
mkdirSync(SALIDA, { recursive: true });
const { ROLE_PERMISSIONS, PLATFORM_PERMISSIONS } = await import('../../apps/api/dist/authz/catalog.js');

// ---- credenciales (sin imprimirlas)
const NL = String.fromCharCode(10);
const csv = readFileSync('CREDENCIALES.csv', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => { const o = []; let c = ''; let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; });
const cab = csv.shift(); const col = (n) => cab.indexOf(n);
const cuentas = [...new Map(csv.map((f) => [f[col('email')], { alias: f[col('email')].split('@')[0], email: f[col('email')], pass: f[col('contrasena')] }])).values()];

const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();
const conteos = () => db("select (select count(*) from producers)||'/'||(select count(*) from plots)||'/'||(select count(*) from deliveries)||'/'||(select count(*) from lots)||'/'||(select count(*) from dd_cases)||'/'||(select count(*) from dd_snapshots)||'/'||(select count(*) from access_grants)||'/'||(select count(*) from documents)||'/'||(select count(*) from satellite_jobs)||'/'||(select count(*) from memberships)||'/'||(select count(*) from users)");
const pedir = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); let b = null; try { b = await r.json(); } catch { /* sin cuerpo */ } return { s: r.status, b }; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? b?.grants ?? []);

// ---- menú esperado por permisos (misma regla que apps/web/lib/workspace.tsx, escrita aquí como tabla para contrastar)
const REGLAS = [
  ['', (p) => true], // «Resumen de la organización» o «Mi espacio»: siempre
  ['/mi-finca', (p) => p('producer:read_own') && !p('producer:read') && !p('producer:read_assigned')],
  ['/onboarding', (p) => p('organization:read')],
  ['/productores', (p) => p('producer:read') || p('producer:read_assigned') || p('producer:read_own')],
  ['/parcelas', (p) => p('plot:read') || p('plot:read_assigned') || p('plot:read_own')],
  ['/captura', (p) => (p('plot:update') || p('plot:update_assigned') || p('plot:update_own')) && p('plot:read_geometry')],
  ['/productores/coincidencias', (p) => p('producer:review_duplicates')],
  ['/entregas', (p) => p('delivery:read') || p('delivery:read_assigned')],
  ['/lotes', (p) => p('lot:read')], ['/inventario', (p) => p('stock:read')], ['/embarques', (p) => p('shipment:read')], ['/traspasos', (p) => p('transfer:read')],
  ['/analisis-autorizados', (p) => p('satellite:read') && !p('plot:read_own')],
  ['/procesos', (p) => p('lot:read')], ['/productos', (p) => p('product:read')],
  ['/trazabilidad/hitos', (p) => p('traceability:read_catalog')],
  ['/legalidad', (p) => p('document:read')], ['/documentos', (p) => p('document:read')], ['/evidencias', (p) => p('evidence:read')], ['/riesgo', (p) => p('risk:read')],
  ['/mitigaciones', (p) => p('mitigation:read')], ['/diligencia', (p) => p('dd:read')], ['/simulacion', (p) => p('dd:read')],
  ['/geolocalizacion', (p) => p('traceability:read_catalog')], ['/intercambio', (p) => p('exchange:use')], ['/presupuesto', (p) => p('cost:read')],
  ['/historico', (p) => p('plot:read') || p('plot:read_assigned')], ['/indicadores', (p) => p('analytics:read')], ['/reportes', (p) => p('report:read')],
  ['/limites', (p) => p('organization:read')], ['/coste', (p) => p('platform_cost:read')],
  ['/miembros', (p) => p('membership:read')], ['/acceso-plataforma', (p) => p('membership:assign')], ['/perfil-juridico', (p) => p('traceability:read_catalog')],
  ['/importaciones', (p) => p('import:manage')], ['/centros', (p) => p('location:manage')], ['/concesiones', (p) => p('grant:manage')], ['/auditoria', (p) => p('audit:read')],
  ['/entregas-eventos', (p) => p('events:reprocess')], ['/integracion', (p) => p('integration:read')],
];
// ---- lecturas permitidas (200) y sondeos prohibidos (403/404, cuerpo válido) por permiso
const LECTURAS = [
  ['lot:read', '/lots'], ['delivery:read', '/deliveries'], ['delivery:read_assigned', '/deliveries'], ['delivery:read_own', '/deliveries'], ['producer:read', '/producers'], ['producer:read_assigned', '/producers'], ['producer:read_own', '/producers'],
  ['plot:read', '/plots'], ['plot:read_assigned', '/plots'], ['plot:read_own', '/plots'], ['shipment:read', '/shipments'], ['dd:read', '/dd-cases'], ['risk:read', '/risk/lots'],
  ['audit:read', '/audit-logs'], ['membership:read', '/members'], ['grant:manage', '/access-grants'], ['transfer:read', '/custody-transfers'], ['product:read', '/products'], ['document:read', '/documents'],
  ['satellite:read', '/satellite/authorized-plots'], ['organization:read', '/limits'],
];

const resultados = [];
const registrar = (r) => { resultados.push(r); };

const browser = await chromium.launch();
const fallos = [];
const hoy = new Date().toISOString().slice(0, 10);

for (const c of cuentas) {
  const lr = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.pass }) });
  if (lr.status !== 200) { registrar({ cuenta: c.alias, contexto: '—', estado: 'DEFECTO', nota: `inicio de sesión ${lr.status}` }); fallos.push(c.alias); continue; }
  const tok = (await lr.json()).access_token;
  const perms = (await pedir(tok, 'GET', '/api/v1/me/permissions')).b;
  const orgs = lista((await pedir(tok, 'GET', '/api/v1/organizations')).b);
  const nombre = new Map(orgs.map((o) => [o.id, o.name]));
  // Plataforma
  if ((perms.platform_permissions ?? []).length) {
    const esp = [...PLATFORM_PERMISSIONS.SUPER_ADMIN].sort().join();
    const obs = [...perms.platform_permissions].sort().join();
    const lec = (await pedir(tok, 'GET', '/api/v1/organizations')).s;
    const unaOrg = orgs[0]?.id ?? db('select id from organizations order by name limit 1');
    const ajena = (await pedir(tok, 'GET', `/api/v1/organizations/${unaOrg}/plots`)).s;
    const ok = esp === obs && lec === 200 && (ajena === 403 || ajena === 404);
    registrar({ cuenta: c.alias, contexto: 'PLATAFORMA', roles: 'SUPER_ADMIN', permisos: perms.platform_permissions.length, menu: 'n/a (menú de plataforma)', lectura: `organizaciones=${lec}`, rechazo: `datos operativos de una organización=${ajena}`, estado: ok ? 'PASS' : 'DEFECTO', nota: ok ? 'sin lectura operativa implícita' : `catálogo=${esp === obs}` });
    if (!ok) fallos.push(c.alias + ' plataforma');
  }
  for (const k of perms.organizations ?? []) {
    const org = nombre.get(k.organization_id) ?? k.organization_id;
    const tiene = new Set(k.permissions); const p = (x) => tiene.has(x);
    const esperados = [...new Set(k.roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []))].sort();
    const permisosOk = esperados.join() === [...k.permissions].sort().join();
    // Menú (web)
    const ctx = await browser.newContext();
    await ctx.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [tok, 'es']);
    const page = await ctx.newPage();
    await page.goto(`${WEB}/organizaciones/${k.organization_id}`);
    await page.getByRole('complementary', { name: 'Navegación principal' }).waitFor({ timeout: 30000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle');
    const base = `/organizaciones/${k.organization_id}`;
    const observados = new Set((await page.locator('aside a, nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).filter((h) => h && h.startsWith(base)).map((h) => h.slice(base.length)));
    await ctx.close();
    const esperadosMenu = new Set(REGLAS.filter(([, f]) => f(p)).map(([h]) => h));
    const sobran = [...observados].filter((h) => !esperadosMenu.has(h)); const faltan = [...esperadosMenu].filter((h) => !observados.has(h));
    const menuOk = sobran.length === 0 && faltan.length === 0;
    // Lectura permitida
    const lectura = LECTURAS.find(([perm]) => tiene.has(perm));
    const lec = lectura ? (await pedir(tok, 'GET', `/api/v1/organizations/${k.organization_id}${lectura[1]}`)) : null;
    const lecOk = !lectura ? true : lec.s === 200;
    // Rechazos (cuerpo válido): lo que el rol NO tiene
    const antes = conteos();
    const sondeos = [];
    const base2 = `/api/v1/organizations/${k.organization_id}`;
    const lote = lista((await pedir(tok, 'GET', `${base2}/lots`)).b)[0]?.id ?? null;
    if (!tiene.has('grant:manage')) sondeos.push(['conceder acceso externo', 'POST', `${base2}/access-grants`, { operation_id: crypto.randomUUID(), grantee_email: 'comprador.importador@demo.terralink.local', resource_type: 'LOT', resource_id: lote ?? crypto.randomUUID(), expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Sondeo QA (debe ser rechazado)' }, [403]]);
    if (!tiene.has('producer:create') && !tiene.has('producer:create_own')) sondeos.push(['crear productor', 'POST', `${base2}/producers`, { producer_code: 'QA-RECHAZO', legal_name: 'Sondeo QA (debe ser rechazado)' }, [403]]);
    if (!tiene.has('dd:manage')) sondeos.push(['abrir expediente', 'POST', `${base2}/dd-cases`, { operation_id: crypto.randomUUID(), lot_id: lote ?? crypto.randomUUID(), scope_note: 'Sondeo QA (debe ser rechazado)' }, [403, 404]]);
    if (!tiene.has('satellite:authorize')) sondeos.push(['autorizar análisis satelital a otra organización', 'POST', `${base2}/plots/${crypto.randomUUID()}/satellite/authorizations`, { operation_id: crypto.randomUUID(), grantee_organization_id: crypto.randomUUID(), expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Sondeo QA' }, [403, 404]]);
    const otraOrg = orgs.find((o) => o.id !== k.organization_id) ?? null;
    const ajena = otraOrg ? (await pedir(tok, 'GET', `/api/v1/organizations/${otraOrg.id}/lots`)).s : null;
    const rech = [];
    let rechOk = true;
    for (const [que, m, ruta, body, esp] of sondeos) { const r = await pedir(tok, m, ruta, body); const ok = esp.includes(r.s); rechOk &&= ok; rech.push(`${que}=${r.s}${ok ? '' : ' ✗'}`); }
    // Otra organización: solo se prueba si la cuenta NO es miembro de ella (las cuentas con dos contextos se prueban por contexto)
    const miembroDeLaOtra = otraOrg ? (perms.organizations ?? []).some((x) => x.organization_id === otraOrg.id) : false;
    if (otraOrg && !miembroDeLaOtra) { const ok = ajena === 403 || ajena === 404; rechOk &&= ok; rech.push(`otra organización=${ajena}${ok ? '' : ' ✗'}`); }
    const despues = conteos();
    const sinEfecto = antes === despues;
    const estado = permisosOk && menuOk && lecOk && rechOk && sinEfecto ? 'PASS' : 'DEFECTO';
    if (estado !== 'PASS') fallos.push(`${c.alias} @ ${org}`);
    registrar({
      cuenta: c.alias, contexto: org, roles: k.roles.join('+'), permisos: k.permissions.length, permisos_igual_catalogo: permisosOk,
      menu: menuOk ? `${observados.size} entradas, = esperado` : `sobran=${sobran.join(',')} faltan=${faltan.join(',')}`,
      lectura: lectura ? `${lectura[1]}=${lec.s}` : 'sin lectura operativa (BUYER: solo lo concedido)', rechazo: rech.join(' · ') || '—', sin_efecto_en_datos: sinEfecto, estado,
    });
  }
}
await browser.close();
writeFileSync(join(SALIDA, 'matriz-cuentas.json'), JSON.stringify({ fecha: '2026-10-30', web: WEB, api: API, resultados }, null, 1));
const w = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
console.log(w('cuenta', 26) + w('contexto', 30) + w('roles', 22) + w('perm', 5) + w('=cat', 5) + w('menú', 12) + w('lectura', 26) + 'estado');
for (const r of resultados) console.log(w(r.cuenta, 26) + w(r.contexto, 30) + w(r.roles, 22) + w(r.permisos, 5) + w(r.permisos_igual_catalogo === undefined ? '' : r.permisos_igual_catalogo ? 'sí' : 'NO', 5) + w(r.menu?.startsWith('sobran') ? 'DIFIERE' : 'ok', 12) + w(r.lectura, 26) + r.estado);
console.log(`\ncuentas=${cuentas.length} · contextos=${resultados.length} · PASS=${resultados.filter((r) => r.estado === 'PASS').length} · DEFECTO=${resultados.filter((r) => r.estado !== 'PASS').length}`);
for (const r of resultados.filter((x) => x.estado !== 'PASS')) console.log('DEFECTO', r.cuenta, '@', r.contexto, '|', r.menu, '|', r.rechazo, '|', r.nota ?? '');
void NL; void hoy;
process.exit(fallos.length ? 1 : 0);
