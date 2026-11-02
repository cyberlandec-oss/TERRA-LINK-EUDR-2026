// Desactualización por el RECORRIDO NORMAL sobre el caso FICTICIO local (ENSAYO-LOCAL-DD-1101: parcela, lote de salida y su expediente), con cuentas existentes y las API reales.
// Es REPETIBLE: parte de un estado vigente que el propio guion crea (GIS → riesgo → instantánea) y cada ejecución añade registros nuevos, nunca modifica los anteriores.
//  1) estado vigente: GIS, riesgo e instantánea del expediente figuran vigentes;
//  2) un cambio relevante por la API normal (superficie declarada de la parcela de origen) los deja desactualizados, cada uno con su motivo;
//  3) el historial conserva su contenido (huella idéntica) y reevaluar/recapturar genera registros NUEVOS;
//  4) la instantánea nueva sigue BLOQUEADA por las compuertas regulatorias: no se elimina ni se simula ninguna.
//   node e2e/review/desactualizacion-demostracion.mjs [--base http://localhost:4000] [--marca ENSAYO-LOCAL-DD-1101] [--lote LOT-2026-00011]
import { createHash, randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const MARCA = arg('--marca', 'ENSAYO-LOCAL-DD-1101');
const LOTE = arg('--lote', 'LOT-2026-00011');
const res = [];
const caso = (t, ok, det = '') => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${t.padEnd(108)} ${det}`); res.push(ok); };
const tok = async (a) => { const c = cuentaDemo(a); return (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token; };
const js = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const huella = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
// El contenido de una instantánea sin la lectura de vigencia (que legítimamente cambia).
const contenido = (s) => { const { readiness, freshness, ...resto } = s ?? {}; return resto; };

const eudr = await tok('eudr.cooperativa');
const admin = await tok('admin.cooperativa');
const org = (await js(admin, 'GET', '/api/v1/organizations')).b.find((o) => o.name.includes('Cooperativa'));
const A = `/api/v1/organizations/${org.id}`;
const caseRow = (await js(eudr, 'GET', `${A}/dd-cases`)).b.cases.find((c) => c.lot_code === LOTE);
const lotId = caseRow.lot_id;
const plot = ((await js(admin, 'GET', `${A}/plots?q=${MARCA}`)).b.items ?? []).find((p) => p.plot_code === MARCA);
const snap = async (id) => (await js(eudr, 'GET', `${A}/dd-snapshots/${id}`)).b;
const riskHist = async () => (await js(eudr, 'GET', `${A}/risk/lots/${lotId}`)).b.history ?? [];
console.log(`caso ${caseRow.case_number} · lote ${LOTE} · parcela ${MARCA}`);

// 1) Estado vigente creado por este guion.
const gis0 = await js(admin, 'POST', `${A}/plots/${plot.id}/gis-evaluations`, { operation_id: randomUUID() });
const gisId = gis0.b?.evaluation?.id ?? gis0.b?.id;
const rk0 = await js(eudr, 'POST', `${A}/risk/lots/${lotId}/evaluations`, { operation_id: randomUUID() });
const riskId = rk0.b?.evaluation?.id;
const cap0 = await js(eudr, 'POST', `${A}/dd-cases/${caseRow.id}/snapshots`, { operation_id: randomUUID() });
const snapId = cap0.b?.snapshot?.id;
caso('1) se crean GIS, riesgo e instantánea nuevos (identificadores distintos)', gis0.s === 201 && rk0.s === 201 && cap0.s === 201 && !!gisId && !!riskId && !!snapId && new Set([gisId, riskId, snapId]).size === 3, `HTTP ${gis0.s}/${rk0.s}/${cap0.s}`);
const gA = (await js(admin, 'GET', `${A}/gis-evaluations/${gisId}`)).b;
const rA = (await js(eudr, 'GET', `${A}/risk/evaluations/${riskId}`)).b;
const sA = await snap(snapId);
caso('   los tres figuran VIGENTES antes del cambio', gA.stale === false && rA.freshness?.status === 'CURRENT' && sA.readiness?.effective !== 'STALE', `GIS stale=${gA.stale}; riesgo=${rA.freshness?.status}; expediente=${sA.readiness?.effective}`);
caso('   la instantánea está BLOQUEADA (no READY): consultable, no vigente como paquete final', sA.readiness?.effective === 'BLOCKED', `efectiva=${sA.readiness?.effective}`);
const hGis = huella(gA.result ?? gA.summary ?? gA.findings ?? gA.items ?? null);
const hRisk = huella({ r: rA.result ?? rA.technical_result ?? null, n: rA.evaluation_number });
const hSnap = huella(contenido(sA));
const nRiesgoAntes = (await riskHist()).length;

// 2) Cambio relevante por la API normal.
const p0 = (await js(admin, 'GET', `${A}/plots/${plot.id}`)).b;
const area0 = Number(p0.area_declared_ha ?? p0.current_version?.area_declared_ha ?? 1);
const area1 = Math.round((area0 + 0.25) * 10000) / 10000;
const cambio = await js(admin, 'POST', `${A}/plots/${plot.id}/declared-area`, { expected_version: Number(p0.row_version), area_declared_ha: area1 });
caso('2) cambio relevante por la API normal: superficie declarada (versión nueva de la parcela)', cambio.s === 201 && area1 !== area0, `HTTP ${cambio.s}: ${area0} → ${area1} ha`);
const gB = (await js(admin, 'GET', `${A}/gis-evaluations/${gisId}`)).b;
const rB = (await js(eudr, 'GET', `${A}/risk/evaluations/${riskId}`)).b;
const sB = await snap(snapId);
caso('   GIS desactualizada con motivo', gB.stale === true && /PLOT_VERSION_CHANGED/.test((gB.stale_reasons ?? []).join(',')), `motivos=${(gB.stale_reasons ?? []).join(',')}`);
caso('   riesgo desactualizado con motivo', rB.freshness?.status === 'STALE' && !!rB.freshness?.reason, rB.freshness?.reason?.slice(0, 80));
caso('   expediente desactualizado, con las secciones cambiadas', sB.readiness?.effective === 'STALE' && (sB.readiness?.changed_sections ?? []).includes('plots'), `secciones: ${JSON.stringify(sB.readiness?.changed_sections)}`);
caso('   el historial conserva su contenido: huellas de GIS, riesgo e instantánea idénticas a las de antes', huella(gB.result ?? gB.summary ?? gB.findings ?? gB.items ?? null) === hGis && huella({ r: rB.result ?? rB.technical_result ?? null, n: rB.evaluation_number }) === hRisk && huella(contenido(sB)) === hSnap, `gis ${hGis} · riesgo ${hRisk} · expediente ${hSnap}`);

// 3) Reevaluar y recapturar: registros nuevos.
const gis1 = await js(admin, 'POST', `${A}/plots/${plot.id}/gis-evaluations`, { operation_id: randomUUID() });
const rk1 = await js(eudr, 'POST', `${A}/risk/lots/${lotId}/evaluations`, { operation_id: randomUUID() });
const cap1 = await js(eudr, 'POST', `${A}/dd-cases/${caseRow.id}/snapshots`, { operation_id: randomUUID() });
const nuevos = [gis1.b?.evaluation?.id ?? gis1.b?.id, rk1.b?.evaluation?.id, cap1.b?.snapshot?.id];
caso('3) reevaluar y recapturar crean registros NUEVOS (identificadores distintos de los anteriores)', gis1.s === 201 && rk1.s === 201 && cap1.s === 201 && nuevos.every((x, i) => x && x !== [gisId, riskId, snapId][i]), `HTTP ${gis1.s}/${rk1.s}/${cap1.s}`);
caso('   los anteriores siguen consultables y desactualizados (no se sobrescribieron)', (await js(admin, 'GET', `${A}/gis-evaluations/${gisId}`)).b.stale === true && (await js(eudr, 'GET', `${A}/risk/evaluations/${riskId}`)).b.freshness?.status === 'STALE' && (await snap(snapId)).readiness.effective === 'STALE');
caso('   el historial de riesgo suma exactamente una evaluación y conserva las anteriores', (await riskHist()).length === nRiesgoAntes + 1, `antes ${nRiesgoAntes} → después ${(await riskHist()).length}`);
const sC = await snap(nuevos[2]);
caso('4) la instantánea nueva sigue BLOQUEADA por las compuertas regulatorias (no READY, nada simulado)', sC.readiness?.effective === 'BLOCKED', `efectiva=${sC.readiness?.effective}`);
console.log(`\n${res.filter(Boolean).length}/${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
