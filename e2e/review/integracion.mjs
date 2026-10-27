// P1-008 — Integración ERP/API por webhooks: recorrido completo contra un RECEPTOR LOCAL (RF-39).
//
//   node e2e/review/integracion.mjs [--web http://localhost:3000] [--base http://localhost:4000]
//
// El receptor lo levanta este mismo arnés, en este equipo. **No se contacta ningún destino externo.**
//
// Lo que tiene que quedar demostrado, de principio a fin:
//   1. **configuración autorizada**: quien tiene el permiso configura un destino; quien no, no;
//   2. **secreto entregado UNA vez**, nunca republicado, y no legible en la lista ni en la pantalla;
//   3. **evento real → entrega firmada**: el receptor la recibe y **verifica la firma con su secreto**;
//   4. **firma inválida**: la misma entrega con otro secreto **no** valida —la comprobación discrimina—;
//   5. **asociación de referencias**: agregado y, en un evento de expediente, **paquete exacto** y
//      **submission = NOT_SUBMITTED**;
//   6. **consulta del resultado**: cada intento, con su causa, también los fallidos;
//   7. **fallo y recuperación**: receptor caído → intento registrado → receptor repuesto → entrega;
//   8. **duplicados**: el mismo evento **no** se reenvía, y el identificador de entrega es estable;
//   9. **destinos internos y secretos**: la configuración no abre la red privada, el secreto no se filtra;
//  10. **aislamiento, permisos, enlaces, teclado y 390 px**.
//
// **Cambia datos DEMO**: crea destinos de ENSAYO y un productor de ENSAYO para provocar un evento.
// No modifica destinos ajenos ni ningún otro módulo.
import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { chromium } from '@playwright/test';
import { cuentaDemo } from './consulta-api.mjs';
import { exigeEntrada } from './comprobacion.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const WEB = arg('--web', 'http://localhost:3000');
const API = arg('--base', 'http://localhost:4000');
const COOP = 'e8dbdab9-08ec-4867-908e-f23138dbca28';
// Por dónde alcanza la API a este receptor. La API corre en un contenedor, así que su `127.0.0.1` es el
// contenedor, no este equipo: el nombre por defecto es el que Docker publica para el anfitrión. Con la API
// en el propio equipo, `--receptor 127.0.0.1`.
const RECEPTOR = arg('--receptor', 'host.docker.internal');
const SELLO = new Date().toISOString().slice(11, 19).replace(/:/g, '');

const resultados = [];
async function caso(titulo, fn) {
  try {
    const [ok, detalle] = await fn();
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${titulo.padEnd(66)} ${detalle}`);
    resultados.push(ok);
  } catch (e) {
    console.log(`FALLA ${titulo.padEnd(66)} ${e.message}`);
    resultados.push(false);
  }
}
async function sesion(local) {
  const c = cuentaDemo(local);
  const r = await fetch(`${API}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.contrasena }) });
  if (!r.ok) throw new Error(`login de ${local}: ${r.status}`);
  return { cuenta: c, token: (await r.json()).access_token };
}
const pedir = async (token, metodo, path, cuerpo) => {
  const r = await fetch(`${API}${path}`, {
    method: metodo,
    headers: { authorization: `Bearer ${token}`, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  let body = null; try { body = JSON.parse(t); } catch { /* no JSON */ }
  return { status: r.status, body };
};

/** La misma verificación que haría el ERP del cliente, escrita aquí a propósito: si el receptor no puede
 *  comprobar la firma por su cuenta, la firma no sirve de nada. */
function verifica(secreto, cuerpo, firma, toleranciaSegundos = 300) {
  const partes = Object.fromEntries(String(firma).split(',').map((p) => p.split('=')));
  if (!partes.t || !partes.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(partes.t)) > toleranciaSegundos) return false;
  const esperada = createHmac('sha256', secreto).update(`${partes.t}.${cuerpo}`).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(partes.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------ receptor LOCAL
const recibidas = [];
let respuesta = { status: 200, body: 'ok' };
/** Modo «la respuesta se pierde»: el receptor PROCESA y después se corta la conexión. */
let perderRespuesta = false;
/** Efectos del receptor, por identificador de entrega. Es SU deduplicación, no la nuestra. */
const efectos = new Map();
const receptor = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    recibidas.push({ path: req.url ?? '', body: cuerpo, headers: req.headers });
    const id = String(req.headers['x-terra-delivery-id'] ?? '');
    if (perderRespuesta) {
      // Lo que hace un receptor correcto: deduplicar por el identificador estable.
      if (!efectos.has(id)) {
        efectos.set(id, 1);        // procesa UNA vez…
        req.socket.destroy();      // …y la respuesta no llega nunca
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('duplicado reconocido');
      return;
    }
    res.writeHead(respuesta.status, { 'content-type': 'text/plain' });
    res.end(respuesta.body);
  });
});
// Escucha en todas las interfaces porque quien tiene que alcanzarlo es el contenedor de la API, no este
// proceso. Vive lo que dura la revisión y se cierra al terminar.
await new Promise((r) => receptor.listen(0, '0.0.0.0', r));
const PUERTO = receptor.address().port;
const destinoUrl = (code) => `http://${RECEPTOR}:${PUERTO}/recibe/${code}`;
const porRuta = (code) => recibidas.filter((r) => r.path === `/recibe/${code}`);
const esperar = async (cond, ms = 20000) => {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
};

const admin = await sesion('admin.cooperativa');
const tecnico = await sesion('tecnico1.cooperativa');
const wh = (org = COOP) => `/api/v1/organizations/${org}/integration/webhooks`;
const configurar = (token, code, extra = {}, org = COOP) => pedir(token, 'POST', wh(org), {
  operation_id: randomUUID(), code, url: destinoUrl(code), event_types: ['ProducerRegistered'], ...extra,
});

const CODE = `ensayo-${SELLO}`;
const CODE_FALLA = `ensayo-falla-${SELLO}`;

try {
  // ------------------------------------------------------------------ API
  let secretoDelDestino = null;

  await caso('CONFIGURACIÓN AUTORIZADA: el administrador configura; el técnico no puede', async () => {
    const delTecnico = await configurar(tecnico.token, `${CODE}-tec`);
    const delAdmin = await configurar(admin.token, CODE);
    if (delAdmin.status !== 201) throw new Error(`configurar respondió ${delAdmin.status} ${JSON.stringify(delAdmin.body?.error)}`);
    secretoDelDestino = exigeEntrada('secreto del destino', delAdmin.body.secret);
    return [delTecnico.status === 403 && delAdmin.status === 201 && secretoDelDestino.length > 20,
      `técnico → ${delTecnico.status} · administrador → ${delAdmin.status} con secreto de ${secretoDelDestino.length} caracteres`];
  });

  await caso('EL SECRETO se entrega UNA vez: la lista solo publica su huella', async () => {
    const lista = await pedir(admin.token, 'GET', wh());
    const d = exigeEntrada('destino recién creado', lista.body.destinations.find((x) => x.code === CODE));
    const enTodoElCuerpo = JSON.stringify(lista.body).includes(secretoDelDestino);
    return [!enTodoElCuerpo && d.secret_fingerprint?.length === 16 && d.secret === undefined,
      `secreto ausente de la lista=${!enTodoElCuerpo} · huella=${d.secret_fingerprint}`];
  });

  await caso('UN TIPO DE EVENTO INEXISTENTE se rechaza: suscribirse a nada parecería estar bien', async () => {
    const malo = await configurar(admin.token, `${CODE}-fantasma`, { event_types: ['ProducerCreated'] });
    const lista = await pedir(admin.token, 'GET', wh());
    return [malo.status === 422 && malo.body?.error?.code === 'EVENT_TYPE_UNKNOWN'
      && lista.body.event_catalog.includes('ProducerRegistered')
      && !lista.body.event_catalog.includes('ProducerCreated'),
    `tipo inventado → ${malo.status} ${malo.body?.error?.code} · catálogo publicado con ${lista.body.event_catalog.length} tipos`];
  });

  await caso('DESTINO INTERNO Y ESQUEMA: la configuración no abre la red privada', async () => {
    // En esta instalación de revisión los destinos locales están ADMITIDOS a propósito (hay que poder
    // demostrar el recorrido sin salir a internet). Lo que se comprueba aquí es que el producto DECLARA
    // ese modo, en vez de silenciarlo, y que lo que no es una dirección sigue sin admitirse.
    const lista = await pedir(admin.token, 'GET', wh());
    const noUrl = await configurar(admin.token, `${CODE}-malo`, { url: 'no-es-una-url' });
    const noResuelve = await configurar(admin.token, `${CODE}-malo2`, { url: 'https://no-resuelve.invalid/x' });
    const declara = lista.body.local_destinations_allowed
      ? /ADMITE destinos locales/i.test(lista.body.mode_note)
      : /no pueden resolver a direcciones internas/i.test(lista.body.mode_note);
    return [noUrl.status === 422 && noResuelve.status === 422 && declara,
      `URL inválida → ${noUrl.status} · host inexistente → ${noResuelve.status} · modo declarado=${declara}`];
  });

  let entregaFirmada = null;

  await caso('EVENTO REAL → ENTREGA FIRMADA que el receptor verifica con SU secreto', async () => {
    const antes = porRuta(CODE).length;
    const prod = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/producers`, {
      producer_code: `WH-${SELLO}`, legal_name: `Finca de ensayo ${SELLO}`,
    });
    if (prod.status !== 201) throw new Error(`crear productor respondió ${prod.status}`);
    const llego = await esperar(() => porRuta(CODE).length > antes);
    if (!llego) throw new Error('el receptor local no recibió ninguna entrega');
    entregaFirmada = porRuta(CODE).at(-1);

    const firma = String(entregaFirmada.headers['x-terra-signature'] ?? '');
    const valida = verifica(secretoDelDestino, entregaFirmada.body, firma);
    const conOtro = verifica('secreto-equivocado', entregaFirmada.body, firma);
    return [valida && !conOtro && /^t=\d+,v1=[0-9a-f]{64}$/.test(firma),
      `firma válida con su secreto=${valida} · con otro secreto=${conOtro} (debe ser false)`];
  });

  await caso('FIRMA INVÁLIDA: alterar el cuerpo o la marca de tiempo la invalida', async () => {
    const firma = String(entregaFirmada.headers['x-terra-signature']);
    const cuerpoAlterado = `${entregaFirmada.body} `;
    const otraMarca = firma.replace(/^t=\d+/, `t=${Math.floor(Date.now() / 1000) - 10}`);
    return [!verifica(secretoDelDestino, cuerpoAlterado, firma) && !verifica(secretoDelDestino, entregaFirmada.body, otraMarca),
      `cuerpo alterado → inválida · marca cambiada → inválida (el instante va DENTRO de lo firmado)`];
  });

  await caso('ASOCIACIÓN DE REFERENCIAS: agregado, y el aviso de que no acredita nada', async () => {
    const c = JSON.parse(entregaFirmada.body);
    const sinPaquete = c.references?.package === undefined;
    return [c.event?.type === 'ProducerRegistered' && c.organization_id === COOP
      && c.subject?.aggregate_type === 'PRODUCER' && typeof c.subject?.aggregate_id === 'string'
      && /No acredita conformidad EUDR ni presentación oficial/i.test(c.disclaimer) && sinPaquete,
    `evento=${c.event?.type} · agregado=${c.subject?.aggregate_type} · sin paquete inventado=${sinPaquete}`];
  });

  await caso('REFERENCIA DE PAQUETE Y SUBMISSION: exacta cuando el evento es de expediente', async () => {
    // Destino suscrito a los eventos del expediente. Si el DEMO no tiene ninguno, se dice: no se finge.
    const code = `ensayo-dd-${SELLO}`;
    const cfg = await configurar(admin.token, code, { event_types: ['DdSnapshotCaptured', 'DdPackageExported'] });
    if (cfg.status !== 201) throw new Error(`configurar el destino de expediente respondió ${cfg.status}`);
    const casos = await pedir(admin.token, 'GET', `/api/v1/organizations/${COOP}/dd-cases`);
    // La lista TIENE que responder: una ruta equivocada devolvía «no hay expedientes» y el caso pasaba
    // sin comprobar nada. Si no responde 200, esto falla en vez de darse por bueno.
    if (casos.status !== 200) throw new Error(`la lista de expedientes respondió ${casos.status}`);
    const expediente = exigeEntrada('expediente del DEMO', (casos.body?.cases ?? [])[0]);

    const antes = porRuta(code).length;
    const snap = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/dd-cases/${expediente.id}/snapshots`, { operation_id: randomUUID() });
    if (snap.status !== 201) throw new Error(`capturar instantánea respondió ${snap.status} ${JSON.stringify(snap.body?.error)}`);
    const llego = await esperar(() => porRuta(code).length > antes);
    if (!llego) throw new Error('no llegó la entrega del evento de expediente');
    const c = JSON.parse(porRuta(code).at(-1).body);
    const p = c.references?.package;
    const s = c.references?.submission;
    return [!!p?.case_id && !!p?.snapshot_id && typeof p?.snapshot_number === 'number' && !!p?.content_hash
      && s?.status === 'NOT_SUBMITTED' && /no es presentar una DDS/i.test(s?.note ?? ''),
    `paquete ${p?.case_number} #${p?.snapshot_number} huella=${String(p?.content_hash).slice(0, 12)}… · submission=${s?.status}`];
  });

  await caso('CONSULTA DEL RESULTADO: el intento se ve con su resultado y su duración', async () => {
    const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${CODE}`);
    const a = exigeEntrada('intento de entrega', r.body.attempts[0]);
    return [r.status === 200 && a.status === 'ENTREGADO' && a.http_status === 200 && a.attempt === 1
      && typeof a.duration_ms === 'number' && a.event_type === 'ProducerRegistered',
    `estado=${a.status} HTTP ${a.http_status} intento ${a.attempt} en ${a.duration_ms} ms`];
  });

  await caso('DUPLICADOS: el mismo evento NO se reenvía al destino que ya lo recibió', async () => {
    const antes = porRuta(CODE).length;
    // Se deja pasar el tiempo que tardaría otro ciclo del bus: si hubiera reenvío, se vería.
    await new Promise((r) => setTimeout(r, 4000));
    const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${CODE}`);
    const ids = new Set(r.body.attempts.map((a) => a.delivery_id));
    return [porRuta(CODE).length === antes && r.body.attempts.length === 1 && ids.size === 1
      && /no reenvía un evento cuya entrega REGISTRÓ como lograda/i.test((await pedir(admin.token, 'GET', wh())).body.idempotency_note),
    `entregas recibidas ${antes} → ${porRuta(CODE).length} · ${r.body.attempts.length} intento(s) · identificador estable`];
  });

  await caso('FALLO Y RECUPERACIÓN: receptor caído → intento con su causa → repuesto → entrega', async () => {
    respuesta = { status: 503, body: 'receptor en mantenimiento' };
    const cfg = await configurar(admin.token, CODE_FALLA);
    if (cfg.status !== 201) throw new Error(`configurar respondió ${cfg.status}`);
    const prod = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/producers`, {
      producer_code: `WHF-${SELLO}`, legal_name: `Finca de ensayo fallo ${SELLO}`,
    });
    if (prod.status !== 201) throw new Error(`crear productor respondió ${prod.status}`);

    const hayFallo = await (async () => {
      const fin = Date.now() + 25000;
      while (Date.now() < fin) {
        const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${CODE_FALLA}`);
        if ((r.body?.attempts ?? []).some((a) => a.status === 'RECHAZADO')) return r.body.attempts.find((a) => a.status === 'RECHAZADO');
        await new Promise((res) => setTimeout(res, 500));
      }
      return null;
    })();
    if (!hayFallo) throw new Error('el rechazo no quedó registrado');

    // El receptor se repone: el bus reintenta solo, con su espera creciente.
    respuesta = { status: 200, body: 'ok' };
    const entregado = await (async () => {
      const fin = Date.now() + 60000;
      while (Date.now() < fin) {
        const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${CODE_FALLA}`);
        // LA MISMA entrega, no otra cualquiera: lo que se demuestra es que ESE envío se recupera.
        const ok = (r.body?.attempts ?? []).find((a) => a.status === 'ENTREGADO' && a.delivery_id === hayFallo.delivery_id);
        if (ok) return ok;
        await new Promise((res) => setTimeout(res, 1000));
      }
      return null;
    })();
    if (!entregado) throw new Error('tras reponerse el receptor, la entrega no llegó a lograrse');

    return [hayFallo.http_status === 503 && /mantenimiento/.test(hayFallo.response_excerpt ?? '')
      && entregado.attempt > hayFallo.attempt && entregado.delivery_id === hayFallo.delivery_id,
    `rechazo HTTP ${hayFallo.http_status} («${hayFallo.response_excerpt}») intento ${hayFallo.attempt} → entregado en el ${entregado.attempt}, mismo identificador`];
  });

  await caso('LA GARANTÍA ES AL MENOS UNA VEZ: si la respuesta se pierde, el mensaje vuelve', async () => {
    // Lo que un índice único NO cubre: el receptor procesa y la respuesta no llega. Terra Link no puede
    // saber que se procesó, registra un fallo y el bus reintenta. Quien evita el efecto doble es el RECEPTOR,
    // deduplicando por X-Terra-Delivery-Id, el mismo en todos los reintentos de esa entrega.
    const code = `ensayo-perdida-${SELLO}`;
    efectos.clear();
    perderRespuesta = true;
    const cfg = await configurar(admin.token, code);
    if (cfg.status !== 201) throw new Error(`configurar respondió ${cfg.status}`);
    const prod = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/producers`, {
      producer_code: `WHL-${SELLO}`, legal_name: `Finca de ensayo perdida ${SELLO}`,
    });
    if (prod.status !== 201) throw new Error(`crear productor respondió ${prod.status}`);
    const dosVeces = await esperar(() => porRuta(code).length >= 2, 40000);
    perderRespuesta = false;
    if (!dosVeces) throw new Error(`el mensaje no volvió: llegadas=${porRuta(code).length}`);

    const ids = new Set(porRuta(code).map((r) => String(r.headers['x-terra-delivery-id'])));
    const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${code}`);
    const porIntento = Object.fromEntries((r.body?.attempts ?? []).map((a) => [a.attempt, a.status]));
    const lista = await pedir(admin.token, 'GET', wh());
    return [ids.size === 1 && efectos.get([...ids][0]) === 1
      && porIntento[1] === 'ERROR_DE_RED' && porIntento[2] === 'ENTREGADO'
      && lista.body.delivery_guarantee === 'AL_MENOS_UNA_VEZ'
      && /responsabilidad del receptor/i.test(lista.body.idempotency_note),
    `llegó ${porRuta(code).length} veces con 1 identificador · el receptor lo procesó ${efectos.get([...ids][0])} vez · intento 1=${porIntento[1]}, 2=${porIntento[2]} · garantía publicada=${lista.body.delivery_guarantee}`];
  });

  await caso('APAGAR alcanza a los REINTENTOS PENDIENTES: no se entregan tras apagar', async () => {
    const code = `ensayo-pendiente-${SELLO}`;
    respuesta = { status: 503, body: 'caído' };
    const cfg = await configurar(admin.token, code);
    if (cfg.status !== 201) throw new Error(`configurar respondió ${cfg.status}`);
    const prod = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/producers`, {
      producer_code: `WHP-${SELLO}`, legal_name: `Finca de ensayo pendiente ${SELLO}`,
    });
    if (prod.status !== 201) throw new Error(`crear productor respondió ${prod.status}`);
    const hubo = await esperar(() => porRuta(code).length > 0, 30000);
    if (!hubo) throw new Error('el destino no llegó a recibir ni un intento fallido');
    const fallidas = porRuta(code).length;

    // Se apaga con la entrega AÚN SIN LOGRAR y el receptor se repone: aun así no debe recibir.
    const off = await configurar(admin.token, code, { active: false, reason: 'Se retira con entregas pendientes.' });
    if (off.status !== 201) throw new Error(`apagar respondió ${off.status}`);
    respuesta = { status: 200, body: 'ok' };
    await new Promise((r) => setTimeout(r, 12000));   // tiempo de sobra para varios reintentos del bus

    const r = await pedir(admin.token, 'GET', `${wh()}/attempts?code=${code}`);
    const logradas = (r.body?.attempts ?? []).filter((a) => a.status === 'ENTREGADO').length;
    return [porRuta(code).length === fallidas && logradas === 0,
      `intentos recibidos ${fallidas} → ${porRuta(code).length} tras apagar y reponer el receptor · entregas logradas=${logradas}`];
  });

  await caso('LISTAS PAGINADAS (docs/09:7): límite, cursor y orden estable, sin corte silencioso', async () => {
    // Antes la lista de intentos devolvía «los últimos 100» sin decirlo. Eso no es una página: es un corte
    // invisible, y quien integra no podía saber que faltaba algo.
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const q = `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await pedir(admin.token, 'GET', `${wh()}/attempts${q}`);
      if (r.status !== 200) throw new Error(`intentos respondió ${r.status}`);
      if (r.body.limit !== 3) throw new Error(`el límite pedido no se respetó: ${r.body.limit}`);
      vistos.push(...r.body.attempts);
      cursor = r.body.next_cursor;
      paginas += 1;
      if (paginas > 200) throw new Error('la paginación no termina');
    } while (cursor);

    const unicos = new Set(vistos.map((a) => a.id)).size;
    const fechas = vistos.map((a) => a.sent_at);
    const ordenado = [...fechas].sort().reverse().join('|') === fechas.join('|');
    const limiteAlto = await pedir(admin.token, 'GET', `${wh()}/attempts?limit=500`);
    const cursorMalo = await pedir(admin.token, 'GET', `${wh()}/attempts?cursor=no-es-un-cursor`);
    return [unicos === vistos.length && paginas > 1 && ordenado
      && limiteAlto.status === 400 && cursorMalo.status === 400,
    `${vistos.length} intentos en ${paginas} páginas, ninguno repetido · orden estable=${ordenado} · límite excesivo → ${limiteAlto.status} · cursor inválido → ${cursorMalo.status}`];
  });

  await caso('PERMISOS: consultar es otro permiso, y el técnico no tiene ninguno de los dos', async () => {
    const lista = await pedir(tecnico.token, 'GET', wh());
    const intentos = await pedir(tecnico.token, 'GET', `${wh()}/attempts`);
    const control = await pedir(admin.token, 'GET', wh());
    return [lista.status === 403 && intentos.status === 403 && control.status === 200,
      `técnico: lista → ${lista.status}, intentos → ${intentos.status} · CONTROL administrador → ${control.status}`];
  });

  await caso('AISLAMIENTO: otra organización no se alcanza, ni para leer ni para configurar', async () => {
    const otras = await pedir(admin.token, 'GET', '/api/v1/organizations');
    const ajena = (otras.body ?? []).find((o) => o.id !== COOP);
    if (!ajena) return [true, 'solo hay una organización en el DEMO'];
    const leer = await pedir(admin.token, 'GET', wh(ajena.id));
    const escribir = await configurar(admin.token, `intruso-${SELLO}`, {}, ajena.id);
    const control = await pedir(admin.token, 'GET', wh());
    return [leer.status === 404 && escribir.status === 404 && control.status === 200,
      `ajena: leer → ${leer.status}, configurar → ${escribir.status} (opaco) · CONTROL propia → ${control.status}`];
  });

  await caso('VERIFICAR FIRMA: la utilidad acepta la buena y rechaza la de otro secreto', async () => {
    const cuerpo = JSON.stringify({ prueba: SELLO });
    const t = Math.floor(Date.now() / 1000);
    const buena = `t=${t},v1=${createHmac('sha256', secretoDelDestino).update(`${t}.${cuerpo}`).digest('hex')}`;
    const mala = `t=${t},v1=${createHmac('sha256', 'otro').update(`${t}.${cuerpo}`).digest('hex')}`;
    const si = await pedir(admin.token, 'POST', `${wh()}/${CODE}/verify-signature`, { body: cuerpo, signature: buena });
    const no = await pedir(admin.token, 'POST', `${wh()}/${CODE}/verify-signature`, { body: cuerpo, signature: mala });
    return [si.body?.valid === true && no.body?.valid === false,
      `firma propia → válida=${si.body?.valid} · firma ajena → válida=${no.body?.valid}`];
  });

  await caso('APAGAR UN DESTINO lo apaga: deja de recibir, y se demuestra con un evento nuevo', async () => {
    const apagado = await configurar(admin.token, CODE, { active: false, reason: 'Fin del ensayo de revisión.' });
    if (apagado.status !== 201) throw new Error(`apagar respondió ${apagado.status} ${JSON.stringify(apagado.body?.error)}`);
    const antes = porRuta(CODE).length;
    const prod = await pedir(admin.token, 'POST', `/api/v1/organizations/${COOP}/producers`, {
      producer_code: `WHX-${SELLO}`, legal_name: `Finca de ensayo apagado ${SELLO}`,
    });
    if (prod.status !== 201) throw new Error(`crear productor respondió ${prod.status}`);
    // Se espera lo que tardaría una entrega: si llegara, se vería.
    await new Promise((r) => setTimeout(r, 6000));
    const lista = await pedir(admin.token, 'GET', wh());
    const d = lista.body.destinations.find((x) => x.code === CODE);
    return [porRuta(CODE).length === antes && d.active === false && d.version === 2,
      `entregas ${antes} → ${porRuta(CODE).length} tras el evento nuevo · destino en versión ${d.version}, activo=${d.active}`];
  });

  // ------------------------------------------------------------------ navegador
  const navegador = await chromium.launch();
  try {
    const entrar = async (cuenta, viewport = { width: 1280, height: 900 }) => {
      const ctx = await navegador.newContext({ viewport, locale: 'es-EC' });
      const page = await ctx.newPage();
      await page.goto(WEB);
      await page.getByLabel('Correo').fill(cuenta.cuenta.email);
      await page.getByLabel('Contraseña', { exact: true }).fill(cuenta.cuenta.contrasena);
      await page.getByRole('button', { name: 'Iniciar sesión' }).click();
      await page.getByRole('heading', { level: 1, name: /organizaciones/i }).waitFor({ timeout: 20000 });
      return { ctx, page };
    };
    const abrir = async (page) => {
      await page.goto(`${WEB}/organizaciones/${COOP}/integracion`);
      await page.getByRole('heading', { level: 1, name: 'Integración por webhooks' }).waitFor({ timeout: 20000 });
      await page.locator('table[aria-label="Destinos configurados"]').waitFor({ timeout: 20000 });
    };

    const { ctx, page } = await entrar(admin);

    await caso('ENLACE: se llega desde el menú, y la pantalla avisa de que no acredita nada', async () => {
      await page.goto(`${WEB}/organizaciones/${COOP}`);
      await page.getByRole('link', { name: 'Integración (webhooks)', exact: true }).first().click();
      await page.getByRole('heading', { level: 1, name: 'Integración por webhooks' }).waitFor({ timeout: 20000 });
      const t = await page.locator('main').innerText();
      return [/Recibir un evento no acredita nada/i.test(t) && /NOT_SUBMITTED/.test(t) && !t.includes('**'),
        `aviso presente · se nombra NOT_SUBMITTED · sin markdown a la vista`];
    });

    await caso('PANTALLA: los destinos se ven con su huella, y el secreto NO está a la vista', async () => {
      await abrir(page);
      const filas = await page.locator('table[aria-label="Destinos configurados"] tbody tr').count();
      const t = await page.locator('main').innerText();
      return [filas >= 1 && !t.includes(secretoDelDestino) && /el secreto no se publica/i.test(t)
        && /al menos una vez/i.test(t) && /X-Terra-Delivery-Id/.test(t),
      `${filas} destino(s) · secreto ausente · la garantía «al menos una vez» y el identificador, a la vista`];
    });

    await caso('PANTALLA: cada intento se ve con su resultado, incluido el fallido', async () => {
      await abrir(page);
      await page.locator('table[aria-label="Intentos de entrega"]').waitFor({ timeout: 20000 });
      const t = await page.locator('main').innerText();
      const filas = await page.locator('table[aria-label="Intentos de entrega"] tbody tr').count();
      return [filas >= 2 && /ENTREGADO/.test(t) && /RECHAZADO/.test(t) && /mantenimiento/.test(t),
        `${filas} intentos a la vista · se ven el logrado y el rechazado, con lo que contestó el receptor`];
    });

    await caso('PANTALLA: la página se continúa, y se DICE que hay más en vez de cortar en silencio', async () => {
      await abrir(page);
      await page.locator('table[aria-label="Intentos de entrega"]').waitFor({ timeout: 20000 });
      const antes = await page.locator('table[aria-label="Intentos de entrega"] tbody tr').count();
      const t = await page.locator('main').innerText();
      const avisa = /quedan más|next_cursor/i.test(t);
      const boton = page.getByRole('button', { name: 'Cargar más intentos' });
      if (await boton.count() === 0) {
        return [antes > 0 && avisa, `${antes} intentos y no hay más páginas: no se ofrece continuar`];
      }
      await boton.first().click();
      await page.waitForTimeout(1500);
      const despues = await page.locator('table[aria-label="Intentos de entrega"] tbody tr').count();
      return [despues > antes && avisa,
        `${antes} → ${despues} intentos al continuar la lista · la pantalla avisa de que quedan más`];
    });

    await caso('PANTALLA: el formulario ofrece SOLO los eventos que existen', async () => {
      await abrir(page);
      const casillas = await page.locator('fieldset input[type="checkbox"]').count();
      const t = await page.locator('main').innerText();
      return [casillas >= 20 && /ProducerRegistered/.test(t) && !/ProducerCreated/.test(t),
        `${casillas} tipos ofrecidos · ninguno inventado`];
    });

    await caso('PERMISOS EN PANTALLA: el técnico no ve la sección ni entra por URL', async () => {
      const { ctx: c2, page: p2 } = await entrar(tecnico);
      const enMenu = await p2.getByRole('link', { name: 'Integración (webhooks)', exact: true }).count();
      await p2.goto(`${WEB}/organizaciones/${COOP}/integracion`);
      await p2.waitForTimeout(2500);
      const t = await p2.locator('main').innerText();
      await c2.close();
      // Ni enlace, ni contenido: y lo que ve es un error de acceso, no un «sin datos».
      return [enMenu === 0 && !/Destinos configurados/.test(t) && /(no está disponible|No tienes permiso|403)/i.test(t),
        `enlaces en el menú=${enMenu} · por URL no hay datos, hay un aviso de acceso`];
    });

    await caso('TECLADO: la pantalla se recorre sin ratón y el formulario es alcanzable', async () => {
      await abrir(page);
      await page.keyboard.press('Tab');
      const primero = await page.evaluate(() => document.activeElement?.tagName);
      await page.getByLabel('Nombre del destino').focus();
      const enfocado = await page.evaluate(() => document.activeElement?.id);
      const encabezados = await page.getByRole('heading', { level: 2 }).count();
      return [['A', 'BUTTON', 'INPUT', 'SELECT'].includes(primero ?? '') && enfocado === 'int-code' && encabezados >= 3,
        `primer foco en ${primero} · campo enfocable por su etiqueta (${enfocado}) · ${encabezados} secciones`];
    });

    await caso('390 px: nada se corta y las tablas desplazan en horizontal', async () => {
      const { ctx: c3, page: p3 } = await entrar(admin, { width: 390, height: 844 });
      await p3.goto(`${WEB}/organizaciones/${COOP}/integracion`);
      await p3.getByRole('heading', { level: 1, name: 'Integración por webhooks' }).waitFor({ timeout: 20000 });
      await p3.locator('table[aria-label="Destinos configurados"]').waitFor({ timeout: 20000 });
      const desborde = await p3.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const envueltas = await p3.locator('.table-wrap').count();
      await c3.close();
      return [!desborde && envueltas >= 2, `desborde horizontal=${desborde} · ${envueltas} tabla(s) desplazable(s)`];
    });

    await ctx.close();
  } finally {
    await navegador.close();
  }
} finally {
  // Los destinos de ensayo se APAGAN al terminar: si no, quedan apuntando a un receptor que ya no existe y
  // el bus reintenta contra la nada en cada evento posterior. Append-only: apagar es otra versión con motivo.
  try {
    const lista = await pedir(admin.token, 'GET', wh());
    for (const d of (lista.body?.destinations ?? []).filter((x) => x.code.startsWith('ensayo-') && x.active)) {
      await pedir(admin.token, 'POST', wh(), {
        operation_id: randomUUID(), code: d.code, url: d.url, event_types: d.event_types,
        active: false, reason: 'Fin de la revisión: el receptor de ensayo ya no existe.',
      });
    }
  } catch { /* la limpieza no decide el resultado */ }
  await new Promise((r) => receptor.close(() => r()));
}

const ok = resultados.filter(Boolean).length;
console.log(`\n${ok}/${resultados.length} comprobaciones correctas`);
console.log(`Entregas recibidas por el receptor LOCAL: ${recibidas.length} (ningún destino externo fue contactado)`);
process.exit(ok === resultados.length ? 0 : 1);
