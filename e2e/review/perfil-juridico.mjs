// Revisión del DESPLIEGUE: recorrido de P1-005 (perfil jurídico revisable).
//
//   node e2e/review/perfil-juridico.mjs [--base http://localhost:4000]
//
// Recorre catálogo → adopción → preparar parcela → revisar aplicabilidad → resultado y pendientes → historial,
// con cuentas DEMO reales de distinto rol. Cada denegación lleva su control autorizado (`comprobacion.mjs`).
// Deja el entorno como lo encontró: retira el perfil que adopta.
import { randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : 'http://localhost:4000'; })();
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

async function iniciarSesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.contrasena }),
  });
  if (!r.ok) throw new Error(`login de ${local}: estado ${r.status}`);
  return (await r.json()).access_token;
}

const pedir = (tk, metodo, path, cuerpo) => async () => {
  const r = await fetch(`${base}${path}`, {
    method: metodo,
    headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { body = null; }
  return { status: r.status, body, texto };
};

const rev = crearRevision('P1-005: perfil jurídico revisable');
const admin = await iniciarSesion('admin.cooperativa');
const eudr = await iniciarSesion('eudr.cooperativa');
const auditor = await iniciarSesion('auditor.cooperativa');

const parcelas = await pedir(admin, 'GET', `/api/v1/organizations/${COOP}/plots`)();
const parcela = exigeEntrada('parcela de la cooperativa', (parcelas.body?.items ?? parcelas.body ?? [])[0]?.id);

await rev.caso('CATÁLOGO: declara alcance PARCIAL, lo que falta y reglas candidatas', {
  pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/legal-profile/catalog`), estado: 200, estructura: ['versions'],
  comprueba: (b) => {
    const v = b.versions[0];
    const todasBorrador = v.rules.every((r) => r.review_status === 'DRAFT');
    const vigenciaSinRevisar = v.sources.every((s) => s.legal_validity_reviewed === false);
    return [v.scope === 'PARTIAL' && v.legal_review_status === 'PENDING' && todasBorrador && vigenciaSinRevisar,
      `perfil ${v.version} ${v.scope} · revisión ${v.legal_review_status} · ${v.rules.length} candidatas · ${v.sources.length} fuentes con vigencia sin revisar`];
  },
});

await rev.caso('ADOPTAR: el responsable EUDR no puede', {
  pedir: pedir(eudr, 'POST', `/api/v1/organizations/${COOP}/legal-profile/adoptions`,
    { operation_id: randomUUID(), version: '0.1.0', decision: 'ADOPT', reason: 'Revisión de despliegue' }),
  estado: 403,
});

await rev.caso('CONTROL: el administrador sí adopta', {
  pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/legal-profile/adoptions`,
    { operation_id: randomUUID(), version: '0.1.0', decision: 'ADOPT', reason: 'Revisión de despliegue' }),
  estado: 201, estructura: ['version'],
  comprueba: (b) => [b.version === '0.1.0', `adoptado ${b.version}`],
});
rev.autorizadoDeControl();

const prep = await pedir(eudr, 'POST', `/api/v1/organizations/${COOP}/legal-assessments`,
  { operation_id: randomUUID(), plot_id: parcela })();
const evaluacion = exigeEntrada('evaluación preparada', prep.body?.id);

await rev.caso('PREPARAR: todo arranca en aplicabilidad DESCONOCIDA y no evaluable', {
  pedir: pedir(eudr, 'GET', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}`), estado: 200,
  estructura: ['items', 'summary'],
  comprueba: (b) => {
    const ok = b.items.every((i) => i.applicability === 'UNKNOWN' && i.result === 'NOT_EVALUABLE');
    return [ok && b.summary.satisfies_legal_profile === false,
      `${b.items.length} requisitos, todos desconocidos · satisface el requisito: ${b.summary.satisfies_legal_profile}`];
  },
});

const ev = (await pedir(eudr, 'GET', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}`)()).body;
const it = ev.items[0];

await rev.caso('DESCONOCIDA no puede estar satisfecha', {
  pedir: pedir(eudr, 'PUT', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}/items/${it.id}`,
    { applicability: 'UNKNOWN', result: 'SATISFIED', change_note: 'intento incoherente', expected_version: it.row_version }),
  estado: 422,
});

await rev.caso('APLICABLE sin evidencia solo puede quedar PENDIENTE', {
  pedir: pedir(eudr, 'PUT', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}/items/${it.id}`,
    { applicability: 'APPLICABLE', result: 'PENDING', applicability_reason: 'El predio está en el supuesto', change_note: 'aplicable, falta evidencia', expected_version: it.row_version }),
  estado: 200, estructura: ['result'],
  comprueba: (b) => [b.result === 'PENDING', `resultado=${b.result}`],
});

await rev.caso('CONCURRENCIA: una versión obsoleta no pisa la revisión de otra persona', {
  pedir: pedir(eudr, 'PUT', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}/items/${it.id}`,
    { applicability: 'NOT_APPLICABLE', result: 'NOT_APPLICABLE', change_note: 'con versión vieja', expected_version: it.row_version }),
  estado: 409,
});

await rev.caso('HISTORIAL: el auditor consulta y el cambio quedó registrado', {
  pedir: pedir(auditor, 'GET', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}/items/${it.id}/history`),
  estado: 200, estructura: ['history'],
  comprueba: (b) => [b.history.length >= 1 && b.history.some((h) => h.result === 'PENDING'), `${b.history.length} entrada(s) de historia`],
});

await rev.caso('El auditor NO registra resultados: su rol consulta', {
  pedir: pedir(auditor, 'PUT', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}/items/${it.id}`,
    { applicability: 'APPLICABLE', result: 'PENDING', change_note: 'intento', expected_version: '2' }),
  estado: 403,
});

await rev.caso('El expediente sigue diciendo que esto NO acredita el requisito', {
  pedir: pedir(eudr, 'GET', `/api/v1/organizations/${COOP}/legal-assessments/${evaluacion}`), estado: 200,
  estructura: ['summary', 'profile'],
  comprueba: (b) => [b.summary.satisfies_legal_profile === false && b.profile.scope === 'PARTIAL' && b.profile.legal_review_status === 'PENDING',
    `perfil ${b.profile.scope}, revisión ${b.profile.legal_review_status} · pendientes=${b.summary.pending.length}`],
});

// Se deja el entorno como estaba: el perfil se retira.
await pedir(admin, 'POST', `/api/v1/organizations/${COOP}/legal-profile/adoptions`,
  { operation_id: randomUUID(), version: '0.1.0', decision: 'WITHDRAW', reason: 'Fin de la revisión de despliegue' })();

process.exitCode = rev.resumen();
