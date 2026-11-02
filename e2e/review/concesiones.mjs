// Revisión del DESPLIEGUE: concesiones externas (P0-003) y referencia en la lectura autorizada (RF-47).
//
//   node e2e/review/concesiones.mjs [--base http://localhost:4000]
//
// Comprueba el COMPORTAMIENTO cambiado, no que el servicio responda: conceder, usar la concesión, que la vía
// normal siga cerrada, que la descarga se rechace con su motivo y que revocar corte el acceso. Cada denegación
// va con su control autorizado (`comprobacion.mjs`). No imprime contraseñas, tokens ni referencias.
import { randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : 'http://localhost:4000'; })();
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

async function token(local) {
  const c = cuentaDemo(local);
  if (!c) throw new Error(`cuenta DEMO no encontrada: ${local}`);
  const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: estado ${r.status}`);
  const b = await r.json();
  if (!b.access_token) throw new Error(`login de ${local}: sin access_token`);
  return b.access_token;
}
const pedir = (tk, metodo, path, cuerpo) => async () => {
  const r = await fetch(`${base}${path}`, {
    method: metodo,
    headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const rev = crearRevision('concesiones externas y referencia autorizada');
const admin = await token('admin.cooperativa');          // ORG_ADMIN de la Cooperativa DEMO
const externo = await token('comprador.importador');     // BUYER de OTRA organización DEMO
const externoYo = await pedir(externo, 'GET', '/api/v1/me')();
const externoId = externoYo.body?.id ?? externoYo.body?.user?.id;

// Un lote de la cooperativa, leído por su dueño: de paso comprueba RF-47 en la lectura autorizada.
const lotes = await rev.caso('lotes legibles por su organización (control)', {
  pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/lots`), estado: 200,
  comprueba: (b) => { const l = b.items ?? b.lots ?? b; return [Array.isArray(l) && l.length > 0, `${Array.isArray(l) ? l.length : 0} lote(s)`]; },
});
rev.autorizadoDeControl();

let loteId = null;
if (lotes) {
  const lista = lotes.body.items ?? lotes.body.lots ?? lotes.body;
  loteId = exigeEntrada('lote de prueba', lista[0].id);
  await rev.caso('RF-47: la referencia viaja en la lectura autorizada del lote', {
    pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/lots/${loteId}`), estado: 200,
    estructura: ['id', 'lot_code', 'public_reference'],
    comprueba: (b) => [/^[0-9a-f]{24}$/.test(b.public_reference ?? ''), 'referencia opaca presente'],
  });
}

if (loteId && externoId) {
  // Antes de conceder: la cuenta externa no ve nada.
  await rev.caso('sin concesión, la cuenta externa no ve el lote', {
    pedir: pedir(externo, 'GET', `/api/v1/organizations/${COOP}/lots/${loteId}`), estado: 404,
  });
  await rev.caso('sin concesión, su lista de concedidos está vacía', {
    pedir: pedir(externo, 'GET', '/api/v1/granted'), estado: 200, estructura: ['grants'],
    comprueba: (b) => [b.grants.length === 0, `${b.grants.length} concesión(es)`],
  });

  // La descarga se rechaza con su motivo declarado, no en silencio.
  await rev.caso('la DESCARGA se rechaza con su decisión pendiente', {
    pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/access-grants`, {
      operation_id: randomUUID(), grantee_user_id: externoId, resource_type: 'LOT', resource_id: loteId,
      can_download: true, expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Revisión de despliegue',
    }), estado: 422, estructura: ['error.code'],
    comprueba: (b) => [b.error.code === 'GRANT_DOWNLOAD_PENDING_DECISION', `code=${b.error.code}`],
  });

  // Conceder lectura y usarla.
  const creada = await rev.caso('conceder lectura a la cuenta externa', {
    pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/access-grants`, {
      operation_id: randomUUID(), grantee_user_id: externoId, resource_type: 'LOT', resource_id: loteId,
      expires_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Revisión de despliegue',
    }), estado: 201, estructura: ['grant.id'],
    comprueba: (b) => [b.grant.can_read === true && b.grant.can_download === false, 'lectura sí, descarga no'],
  });

  if (creada) {
    const gid = exigeEntrada('concesión', creada.body.grant.id);
    await rev.caso('la cuenta externa lee la proyección concedida', {
      pedir: pedir(externo, 'GET', `/api/v1/granted/${gid}`), estado: 200, estructura: ['resource_type', 'productores'],
      comprueba: (b) => {
        const t = JSON.stringify(b);
        const sinIdentidad = !/coordinates|geometry|document/i.test(t);
        return [b.resource_type === 'LOT' && sinIdentidad, `agregados sin identidad: ${sinIdentidad}`];
      },
    });
    await rev.caso('la concesión NO abre la vía normal de la organización', {
      pedir: pedir(externo, 'GET', `/api/v1/organizations/${COOP}/lots/${loteId}`), estado: 404,
    });
    await rev.caso('la concesión NO da acceso a productores', {
      pedir: pedir(externo, 'GET', `/api/v1/organizations/${COOP}/producers`), estado: 404,
    });
    await rev.caso('revocar corta el acceso de inmediato', {
      pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/access-grants/${gid}/revoke`, { operation_id: randomUUID(), reason: 'Fin de la revisión' }),
      estado: 201,
    });
    await rev.caso('tras revocar, la proyección ya no se sirve', {
      pedir: pedir(externo, 'GET', `/api/v1/granted/${gid}`), estado: 404,
    });
  }
} else {
  console.log('AVISO  no se pudo preparar lote o cuenta externa: los casos de concesión NO se ejecutan.');
}

process.exitCode = rev.resumen();
