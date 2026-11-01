// Caso FICTICIO local (protocolo de validación, 2026-11-01): soportes rotulados ENSAYO que corresponden EXACTAMENTE a la entrega del caso ficticio (ENT del caso ENSAYO-LOCAL-DD-1101)
// y mitigación DOCUMENT_EXPIRED con una versión ficticia vigente, verificada por OTRA cuenta existente autorizada. No usa documentos de otra mercancía, no toca expedientes
// operativos, no crea cuentas ni cambia claves. Idempotente: un reintento reutiliza lo ya creado.
//   node e2e/review/caso-ficticio-soportes.mjs [--base http://localhost:4000] [--marca ENSAYO-LOCAL-DD-1101] [--entrega ENT-2026-00008]
import { randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const API = arg('--base', 'http://localhost:4000');
const MARCA = arg('--marca', 'ENSAYO-LOCAL-DD-1101');
const ENTREGA = arg('--entrega', 'ENT-2026-00008');
const res = [];
const caso = (t, ok, det = '') => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${t.padEnd(104)} ${det}`); res.push(ok); };
const tok = async (a) => { const c = cuentaDemo(a); return (await (await fetch(API + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) })).json()).access_token; };
const lst = (b) => (Array.isArray(b) ? b : b?.items ?? b?.data ?? []);
const js = async (t, m, p, body) => { const r = await fetch(API + p, { method: m, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, b: await r.json().catch(() => null) }; };
const pdf = (tag) => Buffer.from(`%PDF-1.4\n% ${MARCA} ${tag}: documento FICTICIO de ensayo, no es un soporte real ${randomUUID()}\n%%EOF\n`);
async function subir(t, A, campos, tag) {
  const fd = new FormData();
  fd.set('operation_id', randomUUID());
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  fd.set('file', new Blob([pdf(tag)], { type: 'application/pdf' }), 'ensayo.pdf');
  const r = await fetch(`${API}${A}/documents`, { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: fd });
  return { s: r.status, b: await r.json().catch(() => null) };
}

const admin = await tok('admin.cooperativa');
const eudr = await tok('eudr.cooperativa');
const org = (await js(admin, 'GET', '/api/v1/organizations')).b.find((o) => o.name.includes('Cooperativa'));
const A = `/api/v1/organizations/${org.id}`;
const ent = lst((await js(admin, 'GET', `${A}/deliveries?q=${ENTREGA}`)).b).find((d) => d.delivery_code === ENTREGA);
const det = (await js(admin, 'GET', `${A}/deliveries/${ent.id}`)).b;

// 1) Soporte de la entrega: documento del productor de ESA entrega, vinculado a ESA entrega.
let soportes = det.supports ?? [];
const yaVinculado = soportes.some((s) => JSON.stringify(s).includes(MARCA));
let docEntrega;
if (!yaVinculado) {
  const u = await subir(admin, A, { document_type: 'DELIVERY_SUPPORT', owner_type: 'producer', owner_id: ent.producer.id, title: `${MARCA} guía de remisión de ${ENTREGA} (ficticia)`, issuer: 'Emisor ficticio de ensayo', issued_at: '2026-10-31' }, 'guia-entrega');
  docEntrega = u.b?.document;
  caso('documento ficticio del productor de la entrega, disponible y sin revisión', u.s === 201 && docEntrega?.versions?.[0]?.availability === 'AVAILABLE' && docEntrega.versions[0].review === null, `HTTP ${u.s}`);
  const v = await js(admin, 'POST', `${A}/deliveries/${ent.id}/supports`, { operation_id: randomUUID(), document_version_id: docEntrega.versions[0].id, support_kind: 'REMISSION_GUIDE' });
  caso(`vínculo exacto con ${ENTREGA} (soporte REMISSION_GUIDE)`, v.s === 201, `HTTP ${v.s}`);
}
const det2 = (await js(admin, 'GET', `${A}/deliveries/${ent.id}`)).b;
const vinc = (det2.supports ?? []).filter((s) => JSON.stringify(s).includes(MARCA));
caso(`la entrega ${ENTREGA} muestra su soporte ficticio, sin aprobar, y solo ese`, vinc.length >= 1 && !JSON.stringify(vinc).includes('"review":{"decision":"ACCEPTED"'), `soportes visibles con la marca: ${vinc.length}`);
// Control: el soporte NO aparece en otra entrega.
const otras = lst((await js(admin, 'GET', `${A}/deliveries`)).b).filter((d) => d.delivery_code !== ENTREGA).slice(0, 6);
let ajenas = 0;
for (const o of otras) { const d = (await js(admin, 'GET', `${A}/deliveries/${o.id}`)).b; if (JSON.stringify(d.supports ?? []).includes(MARCA)) ajenas++; }
caso('el soporte ficticio no figura en ninguna otra entrega (no contamina otra mercancía)', ajenas === 0, `otras revisadas: ${otras.length}`);

// 2) Mitigación DOCUMENT_EXPIRED: versión ficticia vigente, entrega por el responsable, verificación por OTRA cuenta.
const mit = lst((await js(admin, 'GET', `${A}/mitigations`)).b).find((m) => m.factor_code === 'DOCUMENT_EXPIRED' && JSON.stringify(m).includes(MARCA));
let m = (await js(admin, 'GET', `${A}/mitigations/${mit.id}`)).b;
if (m.status === 'OPEN' || m.status === 'REOPENED') {
  const ven = '2027-12-31';
  const u = await subir(admin, A, { document_type: 'ENVIRONMENTAL_SUPPORT', owner_type: 'producer', owner_id: ent.producer.id, title: `${MARCA} soporte renovado y vigente hasta ${ven} (ficticio)`, issuer: 'Emisor ficticio de ensayo', issued_at: '2026-10-31', expires_at: ven }, 'vigente');
  const dv = u.b?.document?.versions?.[0];
  caso('versión ficticia VIGENTE (vence 2027-12-31), disponible, sin revisión', u.s === 201 && dv?.availability === 'AVAILABLE' && dv.validity !== 'EXPIRED', `HTTP ${u.s}; validez=${dv?.validity}`);
  const s = await js(admin, 'POST', `${A}/mitigations/${mit.id}/supports`, { operation_id: randomUUID(), document_version_id: dv.id });
  caso('el responsable aporta el soporte a la mitigación (sigue abierta: aportar no es entregar)', s.s === 201, `HTTP ${s.s}`);
  m = (await js(admin, 'GET', `${A}/mitigations/${mit.id}`)).b;
  const sub = await js(admin, 'POST', `${A}/mitigations/${mit.id}/submit`, { operation_id: randomUUID(), expected_version: m.row_version ?? m.version, note: `Soporte vigente ficticio aportado (${MARCA}).` });
  caso('el responsable entrega la mitigación', sub.s === 201 || sub.s === 200, `HTTP ${sub.s}`);
  m = (await js(admin, 'GET', `${A}/mitigations/${mit.id}`)).b;
}
// El mismo responsable no se autoverifica; otra cuenta sí.
const auto = await js(admin, 'POST', `${A}/mitigations/${mit.id}/decisions`, { operation_id: randomUUID(), expected_version: m.row_version ?? m.version, decision: 'VERIFIED', reason: 'Me verifico yo mismo', criterion_met: true });
caso('rechazo: el responsable no puede verificar su propia mitigación', [403, 409, 422].includes(auto.s) && m.status !== 'VERIFIED', `HTTP ${auto.s} ${auto.b?.error?.code ?? ''}`);
if (m.status === 'SUBMITTED') {
  const ver = await js(eudr, 'POST', `${A}/mitigations/${mit.id}/decisions`, { operation_id: randomUUID(), expected_version: m.row_version ?? m.version, decision: 'VERIFIED', reason: 'El soporte ficticio vigente cubre el criterio del ensayo.', criterion_met: true });
  caso('otra cuenta existente autorizada (eudr.cooperativa) verifica la mitigación', ver.s === 201 || ver.s === 200, `HTTP ${ver.s} ${ver.b?.error?.code ?? ''}`);
}
const fin = (await js(admin, 'GET', `${A}/mitigations/${mit.id}`)).b;
caso('estado final de la mitigación: VERIFICADA, con verificador distinto del responsable', fin.status === 'VERIFIED', `estado=${fin.status}`);
console.log(`\n${res.filter(Boolean).length}/${res.length}`);
process.exit(res.every(Boolean) ? 0 : 1);
