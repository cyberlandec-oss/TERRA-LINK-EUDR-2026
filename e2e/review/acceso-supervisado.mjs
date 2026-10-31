// Revisión del DESPLIEGUE: recorrido completo de acceso supervisado (P0-003).
//
//   node e2e/review/acceso-supervisado.mjs [--base http://localhost:4000]
//
// Recorre concesión → descarga → revocación y solicitud de elevación → aprobación → uso → vencimiento, con
// **dos inicios de sesión reales** de la cuenta de plataforma: A autorizada y B denegada aunque compartan
// `token_version`. Cada denegación lleva su control autorizado (`comprobacion.mjs`).
//
// No imprime contraseñas, tokens ni referencias. Deja el entorno como lo encontró: revoca lo que concede y
// termina la elevación que solicita.
import { randomUUID } from 'node:crypto';
import { cuentaDemo } from './consulta-api.mjs';
import { crearRevision, exigeEntrada } from './comprobacion.mjs';

const base = (() => { const i = process.argv.indexOf('--base'); return i > 0 ? process.argv[i + 1] : 'http://localhost:4000'; })();
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';

/** Un inicio de sesión REAL: devuelve el token de esa sesión concreta. */
async function iniciarSesion(local) {
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
  const texto = await r.text();
  let body = null; try { body = JSON.parse(texto); } catch { body = null; }
  return { status: r.status, body, texto };
};

const rev = crearRevision('acceso supervisado: concesión, descarga y elevación');

const admin = await iniciarSesion('admin.cooperativa');
const externo = await iniciarSesion('comprador.importador');
// DOS sesiones independientes de la MISMA cuenta de plataforma.
const superA = await iniciarSesion('superadmin.revision');
const superB = await iniciarSesion('superadmin.revision');

const yo = await pedir(externo, 'GET', '/api/v1/me')();
const externoId = yo.body?.id ?? yo.body?.user?.id;

// ---------------------------------------------------------------- concesión, descarga y revocación
const lotes = await rev.caso('CONTROL: lotes legibles por su organización', {
  pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/lots`), estado: 200,
  comprueba: (b) => { const l = b.items ?? b.lots ?? b; return [Array.isArray(l) && l.length > 0, `${Array.isArray(l) ? l.length : 0} lote(s)`]; },
});
rev.autorizadoDeControl();

let gid = null;
if (lotes && externoId) {
  const lista = lotes.body.items ?? lotes.body.lots ?? lotes.body;
  const loteId = exigeEntrada('lote de prueba', lista[0].id);
  const creada = await rev.caso('conceder lectura y descarga a la cuenta externa', {
    pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/access-grants`, {
      operation_id: randomUUID(), grantee_user_id: externoId, resource_type: 'LOT', resource_id: loteId,
      can_read: true, can_download: true, expires_at: new Date(Date.now() + 3600000).toISOString(),
      reason: 'Recorrido de revisión del despliegue',
    }), estado: 201, estructura: ['grant.id'],
    comprueba: (b) => [b.grant.can_read && b.grant.can_download, 'lectura y descarga'],
  });
  if (creada) {
    gid = creada.body.grant.id;
    const leido = await rev.caso('la cuenta externa lee la proyección concedida', {
      pedir: pedir(externo, 'GET', `/api/v1/granted/${gid}`), estado: 200, estructura: ['resource_type', 'productores'],
      comprueba: (b) => [!/coordinates|geometry|document/i.test(JSON.stringify(b)), 'agregados sin identidad'],
    });
    await rev.caso('la descarga entrega la MISMA proyección, identificada', {
      pedir: pedir(externo, 'GET', `/api/v1/granted/${gid}/download`), estado: 200,
      estructura: ['tipo_de_archivo', 'recurso', 'limitaciones'],
      comprueba: (b) => {
        const igual = JSON.stringify(b.recurso) === JSON.stringify(leido?.body);
        const avisa = /NO es un DD_PACKAGE/.test(b.aviso ?? '') && /NO acredita conformidad EUDR/.test(b.aviso ?? '');
        return [b.tipo_de_archivo === 'VISTA_COMPARTIDA_INTERNA' && igual && avisa, `misma proyección=${igual}, avisos=${avisa}`];
      },
    });
    await rev.caso('revocar corta lectura y descarga', {
      pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/access-grants/${gid}/revoke`, { operation_id: randomUUID(), reason: 'Fin del recorrido' }),
      estado: 201,
    });
    await rev.caso('tras revocar, la descarga ya no se sirve', {
      pedir: pedir(externo, 'GET', `/api/v1/granted/${gid}/download`), estado: 404,
    });
  }
}

// ---------------------------------------------------------------- elevación con DOS sesiones reales
const credSuper = cuentaDemo('superadmin.revision');
await rev.caso('sin elevación, la plataforma no ve los miembros', {
  pedir: pedir(superA, 'GET', `/api/v1/organizations/${COOP}/members`), estado: 403, estructura: ['error.code'],
  comprueba: (b) => [b.error.code === 'ELEVATION_REQUIRED', `code=${b.error.code}`],
});

const solicitud = await rev.caso('solicitar elevación desde la sesión A', {
  pedir: pedir(superA, 'POST', `/api/v1/organizations/${COOP}/platform-elevations`, {
    operation_id: randomUUID(), password: credSuper.contrasena, purpose: 'Soporte de revisión',
    reason: 'Recorrido de despliegue', scope_note: 'Listado de miembros', actions: ['members:read'], duration_seconds: 900,
  }), estado: 201, estructura: ['elevation.id', 'elevation.status'],
  comprueba: (b) => [b.elevation.status === 'PENDING', `estado=${b.elevation.status}`],
});

if (solicitud) {
  const eid = exigeEntrada('elevación', solicitud.body.elevation.id);
  await rev.caso('pendiente: por sí sola no habilita nada', {
    pedir: pedir(superA, 'GET', `/api/v1/organizations/${COOP}/members`), estado: 403,
  });
  await rev.caso('la organización VE la solicitud', {
    pedir: pedir(admin, 'GET', `/api/v1/organizations/${COOP}/platform-elevations`), estado: 200, estructura: ['elevations'],
    comprueba: (b) => [b.elevations.some((x) => x.id === eid), `${b.elevations.length} solicitud(es)`],
  });
  await rev.caso('aprueba un ORG_ADMIN de la organización', {
    pedir: pedir(admin, 'POST', `/api/v1/organizations/${COOP}/platform-elevations/${eid}/approve`, { operation_id: randomUUID(), reason: 'Aprobado para la revisión' }),
    estado: 201, estructura: ['elevation.status'],
    comprueba: (b) => [b.elevation.status === 'APPROVED', `estado=${b.elevation.status}`],
  });

  // El punto de la corrección: A sí, B no, compartiendo cuenta y token_version.
  await rev.caso('la sesión A obtiene la lectura aprobada, redactada', {
    pedir: pedir(superA, 'GET', `/api/v1/organizations/${COOP}/members`), estado: 200,
    comprueba: (b) => {
      const t = JSON.stringify(b);
      const redactado = Array.isArray(b) && b.every((m) => m.redacted === true) && !/@/.test(t);
      return [redactado, `${Array.isArray(b) ? b.length : 0} membresía(s), sin nombres ni correos`];
    },
  });
  await rev.caso('la sesión B de la MISMA cuenta queda denegada', {
    pedir: pedir(superB, 'GET', `/api/v1/organizations/${COOP}/members`), estado: 403, estructura: ['error.code'],
    comprueba: (b) => [b.error.code === 'ELEVATION_REQUIRED', `code=${b.error.code}`],
  });
  await rev.caso('la sesión B tampoco puede finalizar la elevación de A', {
    pedir: pedir(superB, 'POST', `/api/v1/organizations/${COOP}/platform-elevations/${eid}/end`), estado: 404,
  });
  await rev.caso('la elevación NO abre el resto de la organización', {
    pedir: pedir(superA, 'GET', `/api/v1/organizations/${COOP}/producers`), estado: 404,
  });
  await rev.caso('la sesión A la termina anticipadamente', {
    pedir: pedir(superA, 'POST', `/api/v1/organizations/${COOP}/platform-elevations/${eid}/end`), estado: 201,
  });
  await rev.caso('terminada, la plataforma vuelve a quedar fuera', {
    pedir: pedir(superA, 'GET', `/api/v1/organizations/${COOP}/members`), estado: 403,
  });
}

process.exitCode = rev.resumen();
