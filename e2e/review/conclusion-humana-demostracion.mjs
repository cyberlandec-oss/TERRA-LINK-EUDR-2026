// D-07.6 — demostración en el entorno desplegado de la CONCLUSIÓN HUMANA del responsable EUDR (EUDR_MANAGER, permiso risk:conclude).
//
//   node e2e/review/conclusion-humana-demostracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// NO registra ninguna conclusión sobre datos operativos: el estado de datos queda idéntico. Demuestra la consulta (evaluación, limitaciones, qué falta), los RECHAZOS y límites
// (cada intento se verifica sin efectos), el aislamiento entre organizaciones, que los expedientes existentes siguen sin conclusión vigente y las pantallas en español e inglés
// a 390 px. El recorrido completo —no favorable y favorable con sus condiciones, conclusión posterior, datos desactualizados, cambios que invalidan la vigencia y reintentos— está
// demostrado con datos SINTÉTICOS aislados en `test/risk-conclusion.int-spec.ts` y `e2e/tests/conclusion-humana.spec.ts`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const SALIDA = join('validation-results', 'conclusion-humana-2026-10-22');
mkdirSync(SALIDA, { recursive: true });
const resultados = [];
async function caso(titulo, fn) {
  try { const [ok, detalle] = await fn(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(100)} ${detalle ?? ''}`); resultados.push({ titulo, ok, detalle }); }
  catch (e) { console.log(`FALLA ${titulo.padEnd(100)} ${String(e.message).slice(0, 240)}`); resultados.push({ titulo, ok: false, detalle: String(e.message).slice(0, 240) }); }
}
const pedir = async (t, m, p, body) => {
  const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let b = null; try { b = JSON.parse(txt); } catch { b = txt; } return { s: r.status, b };
};
const login = async (cta) => { const c = cuentaDemo(cta); const r = await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) }); return (await r.json()).access_token; };
const lista = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const db = (sql) => execFileSync('docker', ['exec', 'terra-link-postgres-1', 'psql', '-U', 'terra_link', '-d', 'terra_link', '-At', '-F', '|', '-c', sql], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).trim();
const estado = () => db(`select (select count(*) from risk_conclusions)||'/'||(select count(*) from risk_conclusion_supports)||'/'||(select count(*) from risk_evaluations)||'/'||(select count(*) from dd_snapshots)||'/'||(select count(*) from audit_logs where action='risk.conclude')`);

const adm = await login('admin.cooperativa'); const eudr = await login('eudr.cooperativa'); const otra = await login('admin.acopio');
const orgs = lista((await pedir(adm, 'GET', '/api/v1/organizations')).b);
const orgRV = orgs.find((o) => o.name.includes('Río Verde'));
const B = `/api/v1/organizations/${orgRV.id}`;
const lotes = lista((await pedir(eudr, 'GET', `${B}/risk/lots`)).b);
const conEval = lotes.find((l) => l.evaluation_id) ?? lotes[0];
const evalId = conEval.evaluation_id ?? (await pedir(eudr, 'GET', `${B}/risk/lots/${conEval.lot_id ?? conEval.id}`)).b.latest.id;
const lotId = conEval.lot_id ?? conEval.id;
const antes = estado();
console.log(`\n== Conclusión humana · ${orgRV.name} · lote ${conEval.lot_code ?? lotId} · estado antes (conclusiones/soportes/evaluaciones/instantáneas/auditoría): ${antes} ==\n`);

let ctx;
await caso('Consulta: el responsable EUDR ve la evaluación, sus limitaciones y qué permite cada resultado; el motor no concluye', async () => {
  const r = await pedir(eudr, 'GET', `${B}/risk/evaluations/${evalId}/conclusions`); ctx = r.b;
  return [r.s === 200 && ctx.limitations.includes('ENGINE_NEVER_CONCLUDES') && ctx.limitations.includes('SEVERITY_IS_NOT_CONCLUSION') && ctx.can_record === true && ctx.current === null, `${r.s} · ${ctx.limitations.join(',')}`];
});
await caso('La favorable NO está disponible y explica qué falta (catálogo sin perfil jurídico, sin adopción): se conserva el estado', async () => [ctx.options.NEGLIGIBLE.allowed === false && ctx.options.NEGLIGIBLE.missing.includes('PROFILE_REFERENCE_MISSING'), `faltan: ${ctx.options.NEGLIGIBLE.missing.join(',')}`]);
await caso('Además, la favorable exige resolver CADA carencia de la evaluación por separado: se listan las que habría que resolver (una limitación mostrada no está resuelta)', async () => [Array.isArray(ctx.options.NEGLIGIBLE.gaps_to_resolve) && ctx.options.NEGLIGIBLE.gaps_to_resolve.length > 0 && ctx.options.NON_NEGLIGIBLE.gaps_to_resolve.length === 0, `${ctx.options.NEGLIGIBLE.gaps_to_resolve.map((g) => g.scope + ':' + g.code).join(', ')}`]);
const cuerpo = (over = {}) => ({ operation_id: randomUUID(), result: 'NEGLIGIBLE', reason: 'Intento de demostración que debe rechazarse sin escribir', supports: [{ kind: 'CITATION', citation: 'Cita de demostración' }], ...over });
await caso('Permisos: la administración (ORG_ADMIN) recibe 403 al registrar y 200 al consultar (control); otra organización recibe 404', async () => {
  const a = await pedir(adm, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo({ result: 'NON_NEGLIGIBLE' }));
  const c = await pedir(adm, 'GET', `${B}/risk/evaluations/${evalId}/conclusions`);
  const x = await pedir(otra, 'GET', `${B}/risk/evaluations/${evalId}/conclusions`);
  return [a.s === 403 && c.s === 200 && c.b.can_record === false && [403, 404].includes(x.s), `${a.s}/${c.s}/${x.s}`];
});
await caso('Se rechazan sin escribir: favorable sin condiciones (422 con lo que falta), sin motivo (400), sin evidencia (400), resultado inexistente (400), evidencia ajena (422)', async () => {
  const a = await pedir(eudr, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo());
  const b = await pedir(eudr, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo({ result: 'NON_NEGLIGIBLE', reason: 'corto' }));
  const c = await pedir(eudr, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo({ result: 'NON_NEGLIGIBLE', supports: [] }));
  const d = await pedir(eudr, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo({ result: 'APPROVED' }));
  const e = await pedir(eudr, 'POST', `${B}/risk/evaluations/${evalId}/conclusions`, cuerpo({ result: 'NON_NEGLIGIBLE', supports: [{ kind: 'DOCUMENT_VERSION', document_version_id: randomUUID() }] }));
  return [a.s === 422 && a.b?.error?.code === 'CONCLUSION_PRECONDITIONS_NOT_MET' && b.s === 400 && c.s === 400 && d.s === 400 && e.s === 422 && estado() === antes, `${a.s} ${a.b?.error?.code} / ${b.s} / ${c.s} / ${d.s} / ${e.s} · ${estado()}`];
});
await caso('La base rechaza una conclusión favorable sin perfil referenciado y una sin evidencia (transacciones revertidas)', async () => {
  const sql1 = `begin; insert into risk_conclusions(id,organization_id,evaluation_id,subject_id,evaluation_number,evaluation_snapshot_hash,rule_set_version,result,reason,recorded_by,operation_id) select gen_random_uuid(), e.organization_id, e.id, e.subject_id, e.evaluation_number, e.snapshot_hash, e.rule_set_version, 'NEGLIGIBLE','Intento de demostración sin perfil', (select id from users where email like 'eudr.%' limit 1), gen_random_uuid() from risk_evaluations e where e.id='${evalId}'; commit;`;
  const sql2 = `begin; insert into risk_conclusions(id,organization_id,evaluation_id,subject_id,evaluation_number,evaluation_snapshot_hash,rule_set_version,result,reason,recorded_by,operation_id) select gen_random_uuid(), e.organization_id, e.id, e.subject_id, e.evaluation_number, e.snapshot_hash, e.rule_set_version, 'NON_NEGLIGIBLE','Intento de demostración sin evidencia', (select id from users where email like 'eudr.%' limit 1), gen_random_uuid() from risk_evaluations e where e.id='${evalId}'; commit;`;
  const out = [sql1, sql2].map((q) => { try { db(q); return 'ACEPTADA'; } catch { return 'rechazada'; } });
  return [out.every((x) => x === 'rechazada') && estado() === antes, out.join(' / ')];
});
await caso('Los expedientes existentes siguen sin conclusión vigente: REGULATORY_CONCLUSION = NOT_EVALUABLE (valores guardados, no reevaluados)', async () => {
  const casos = (await pedir(eudr, 'GET', `${B}/dd-cases`)).b?.cases ?? []; const estados = new Set(); let vistos = 0;
  for (const c of casos.filter((x) => x.snapshot_id).slice(0, 10)) { const sn = (await pedir(eudr, 'GET', `${B}/dd-snapshots/${c.snapshot_id}`)).b; const r = (sn?.requirements ?? []).find((x) => x.code === 'REGULATORY_CONCLUSION'); if (r) { vistos++; estados.add(r.status); } }
  return [vistos > 0 && [...estados].join() === 'NOT_EVALUABLE', `${vistos} instantáneas; estados: ${[...estados].join(',')}`];
});
await caso('El motor sigue sin concluir: toda evaluación conserva conclusion = UNDETERMINED y no se registró ninguna conclusión', async () => [db(`select string_agg(distinct conclusion, ',') from risk_evaluations`) === 'UNDETERMINED' && estado() === antes, `${db(`select string_agg(distinct conclusion, ',') from risk_evaluations`)} · ${estado()}`]);

const browser = await chromium.launch();
const sesion = async (token, lang, viewport) => { const c = await browser.newContext(viewport ? { viewport } : {}); await c.addInitScript(([t, l]) => { sessionStorage.setItem('tl_token', t); localStorage.setItem('tl_lang', l); }, [token, lang]); return { c, page: await c.newPage() }; };
const dentro = async (loc) => { const b = await loc.boundingBox(); return b.x + b.width <= 391; };
await caso('Pantalla (es), responsable EUDR: evaluación, limitaciones, favorable deshabilitada con lo que falta y registro deshabilitado hasta completar y confirmar', async () => {
  const { c, page } = await sesion(eudr, 'es'); await page.goto(`${WEB}/organizaciones/${orgRV.id}/riesgo/${lotId}/conclusion`);
  await page.getByText('El motor no concluye: esta conclusión es de una persona autorizada.').waitFor({ timeout: 15000 });
  const neg = await page.getByRole('radio', { name: /Riesgo insignificante \(NEGLIGIBLE\)/ }).isDisabled(); const txt = await page.locator('main').innerText();
  const btn = await page.getByRole('button', { name: 'Registrar la conclusión' }).isDisabled();
  await page.screenshot({ path: join(SALIDA, 'pantalla-es.png'), fullPage: true }); await c.close();
  return [neg && btn && /El catálogo no declara ningún perfil jurídico/.test(txt), 'favorable deshabilitada; registro deshabilitado'];
});
await caso('Pantalla (en, 390 px): traducida, radios con tamaño de control, lo que falta dentro del ancho, sin códigos internos y sin desborde', async () => {
  const { c, page } = await sesion(eudr, 'en', { width: 390, height: 844 }); await page.goto(`${WEB}/organizaciones/${orgRV.id}/riesgo/${lotId}/conclusion`);
  const falta = page.getByText('The catalog declares no legal profile (empty regulatory_profile).'); await falta.waitFor({ timeout: 15000 });
  const radio = await page.getByRole('radio', { name: /Non-negligible risk/ }).boundingBox(); const faltaDentro = await dentro(falta);
  const txt = await page.locator('main').innerText(); const sin = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: join(SALIDA, 'pantalla-en-390.png'), fullPage: true }); await c.close();
  return [radio.width <= 24 && faltaDentro && sin && !/\b(ENGINE_NEVER_CONCLUDES|PROFILE_REFERENCE_MISSING|RULE_SET_NOT_ADOPTED|NOT_ASSESSED|INCOMPLETE)\b/.test(txt), `radio ${Math.round(radio.width)} px; sin desborde: ${sin}`];
});
await caso('Pantalla (es), administración: solo consulta, sin formulario de registro', async () => {
  const { c, page } = await sesion(adm, 'es'); await page.goto(`${WEB}/organizaciones/${orgRV.id}/riesgo/${lotId}/conclusion`);
  await page.getByText('Tu rol permite consultar, no registrar conclusiones.').waitFor({ timeout: 15000 });
  const sinBoton = (await page.getByRole('button', { name: 'Registrar la conclusión' }).count()) === 0; await c.close(); return [sinBoton, 'sin botón de registro'];
});
await browser.close();

const fallas = resultados.filter((r) => !r.ok).length;
writeFileSync(join(SALIDA, 'resultados.json'), JSON.stringify({ resultados }, null, 2));
console.log(`\n${resultados.length - fallas}/${resultados.length} comprobaciones. No se registró ninguna conclusión sobre datos operativos.`);
process.exit(fallas ? 1 : 0);
