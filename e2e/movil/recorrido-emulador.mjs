// Recorrido INTEGRADO en EMULADOR Android (no es un teléfono físico): APK de aceptación, cuentas DEMO, fotos de la cámara
// virtual del emulador (escena sintética) y posiciones emuladas (`adb emu geo fix`). Pasos por nombre:
//   node e2e/movil/recorrido-emulador.mjs <paso> [<paso>...]
// Evidencia: docs/qa/movil-emulador/recorrido.json (resultado por paso) y docs/qa/capturas/movil-emulador/*.png.
// Requiere: emulador arrancado, APK instalado, proxy (e2e/movil/proxy.mjs) y `adb reverse tcp:4000 tcp:4001`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, statfsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adb, allText, back, find, hideKeyboard, screenshot, scroll, sleep, tap, tapNode, typeInto, waitFor } from './adb-ui.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const PKG = 'ec.agtech.terralink.campo';
const shots = join(root, 'docs', 'qa', 'capturas', 'movil-emulador');
const evFile = join(root, 'docs', 'qa', 'movil-emulador', 'recorrido.json');
const stateFile = join(root, 'validation-results', 'emulador-estado.json');
mkdirSync(join(root, 'docs', 'qa', 'movil-emulador'), { recursive: true });
const ev = existsSync(evFile) ? JSON.parse(readFileSync(evFile, 'utf8')) : { entorno: 'EMULADOR Android (no teléfono físico)', pasos: [] };
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => { writeFileSync(evFile, `${JSON.stringify(ev, null, 2)}\n`); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };
let shotN = ev.pasos.length;
const shot = (name) => { shotN += 1; const f = `${String(shotN).padStart(2, '0')}-${name}.png`; screenshot(join(shots, f)); return `docs/qa/capturas/movil-emulador/${f}`; };
// Procedencia: huella SHA-256 de ESTE archivo y commit/estado del árbol en cada paso registrado. Las ejecuciones anteriores
// (intentos 5 y 6) no la registraron: ver docs/qa/PROCEDENCIA_SCRIPT_RECORRIDO_2026-10-11.md.
const SCRIPT_SHA256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const gitOut = (...a) => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim(); } catch { return 'desconocido'; } };
const SCRIPT_ORIGEN = { sha256: SCRIPT_SHA256, commit: gitOut('rev-parse', '--short', 'HEAD'), modificado_sin_commit: gitOut('status', '--porcelain', '--', 'e2e/movil/') !== '' };
const record = (paso, ok, detalle, captura = null) => { ev.pasos.push({ paso, en: new Date().toISOString(), ok, detalle, captura, script: SCRIPT_ORIGEN }); save(); console.log(`${ok ? 'OK   ' : 'FALLA'} ${paso}: ${typeof detalle === 'string' ? detalle : JSON.stringify(detalle)}`); };

function creds(local) {
  const file = ['CREDENCIALES.csv', 'CREDENCIALES.pendiente.csv'].map((f) => join(root, f)).filter(existsSync).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  const rows = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => l.split(','));
  const h = rows[0]; const r = rows.find((x) => x[h.indexOf('email')]?.startsWith(`${local}@`));
  return { email: r[h.indexOf('email')], password: r[h.indexOf('contrasena')] };
}
const API = 'http://localhost:4000';
async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(`${API}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
const login = async (local) => { const c = creds(local); return (await api('/api/v1/auth/login', { method: 'POST', body: c })).data.access_token; };
const sql = (q) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-c', `psql -U "$POSTGRES_USER" -d terra_link -tAc "${q.replace(/"/g, '\\"')}"`], { cwd: root, encoding: 'utf8' }).trim();
const proxy = async (modo) => (await fetch(`http://127.0.0.1:4002/modo?valor=${modo}`)).text();
const coopId = async (token) => (await api('/api/v1/organizations', { token })).data.find((o) => o.name.includes('Cooperativa')).id;
const restart = async () => { adb('shell', 'am', 'force-stop', PKG); await sleep(1000); adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'); await sleep(4000); };
const tab = (name) => tap(new RegExp(`^${name}$`));
/** «Mi ubicación» → lectura SIN guardar → acción explícita. Devuelve el texto de la pantalla con la lectura mostrada y aún sin guardar (para verificar que localizarse no guarda). */
/** Busca el texto barriendo la pantalla hacia arriba y hacia abajo (la tarjeta puede quedar fuera de la vista tras pulsar el botón); no se desplaza solo en un sentido. */
async function ver(re, timeout = 30000) {
  const t0 = Date.now(); let i = 0;
  for (;;) {
    const f = find(re); if (f.length) return f[0];
    if (Date.now() - t0 > timeout) throw new Error(`No apareció ${re} en ${timeout} ms`);
    scroll(Math.floor(i / 3) % 2 === 0 ? 'up' : 'down'); i += 1; await sleep(600);
  }
}
async function ubicacionMiUbicacion() {
  await tap(/^Mi ubicación$/);
  await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000); // arranque en frío del proveedor
  const sinGuardar = allText();
  await tap(/^(Usar esta ubicación en el borrador|Reemplazar la ubicación del borrador con esta lectura)$/);
  await ver(/Ubicación guardada en el borrador/, 30000);
  return sinGuardar;
}

async function loginAs(local) {
  await waitFor(/Iniciar sesión/);
  await typeInto(/Servidor \(URL de la API\)/, 'http://localhost:4000');
  const c = creds(local);
  await typeInto(/^Correo$/, c.email);
  await typeInto(/^Contraseña$/, c.password);
  hideKeyboard();
  const btns = find(/^Iniciar sesión$/); tapNode(btns[btns.length - 1]);
  await waitFor(/Elige la organización/, { timeout: 30000 });
  await tap(/DEMO · Cooperativa/);
  await waitFor(/Mi jornada/);
}
async function logout() {
  await tab('Inicio');
  await tap(/^Cerrar sesión$/);
  await waitFor(/¿Cerrar sesión\?/, { scrollTo: true }); // la tarjeta de confirmación reemplaza al botón
  const t = allText();
  scroll('down'); await sleep(600); scroll('down'); await sleep(800); // el botón de confirmar queda bajo el pliegue
  const btns = find(/^Cerrar sesión$/); if (!btns.length) throw new Error('Sin botón de confirmar cierre');
  tapNode(btns[btns.length - 1]);
  await waitFor(/Iniciar sesión/);
  return t;
}
/** Contenido de la pantalla de captura (ubicación guardada y vértices), leído desplazando de arriba abajo: se compara CONTENIDO, no recuentos. */
async function leerBorrador() {
  for (let i = 0; i < 8; i++) { scroll('up'); await sleep(250); }
  const lineas = [];
  for (let i = 0; i < 6; i++) { for (const l of allText().split('\n').map((x) => x.trim()).filter(Boolean)) if (!lineas.includes(l)) lineas.push(l); scroll('down'); await sleep(350); }
  const txt = lineas.join('\n');
  const antesLectura = txt.split('Lectura de «Mi ubicación»')[0];
  const loc = /(?:^|\n)Lat (-?\d+\.\d+) · Lon (-?\d+\.\d+)/.exec(antesLectura);
  const vertices = [...txt.matchAll(/(?:^|\n)(\d+)\. Lat (-?\d+\.\d+) · Lon (-?\d+\.\d+)/g)].map((m) => m[1] + ':' + m[2] + ',' + m[3]);
  return { ubicacion: loc ? loc[1] + ',' + loc[2] : null, vertices, texto: txt };
}
async function abrirCaptura(codigo) {
  // Reinicio de la app: descarta la captura abierta en memoria y deja la sesión (guardada) para llegar a la lista «Nueva captura» sin depender del scroll de Inicio.
  await restart(); const pri = await waitFor(/Elige la organización|Mi jornada/, { timeout: 30000 }); if (/Elige/.test(pri.text + pri.desc)) { await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/); }
  await tab('Captura'); await tap(new RegExp('^' + codigo + ' ·')); await waitFor(/Captura · /);
}
const pendingText = async () => { await tab('Pendientes'); await sleep(1500); return allText(); };
const opIdsShown = (t) => [...t.matchAll(/(Muestra de ubicación|Foto) · ([0-9a-f]{8})/g)].map((m) => `${m[1]}:${m[2]}`);

const steps = {
  async preparar() {
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_FINE_LOCATION');
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    adb('shell', 'pm', 'grant', PKG, 'android.permission.CAMERA');
    adb('shell', 'settings', 'put', 'secure', 'location_mode', '3'); // alta precisión (sin Google Play en la imagen)
    adb('emu', 'geo', 'fix', '-80.1601', '-0.8479');
    await proxy('pass');
    await restart();
    record('preparar', true, 'Permisos de ubicación y cámara concedidos por adb; posición EMULADA -0.8479, -80.1601; proxy en modo pass', shot('inicio'));
  },
  async login() {
    await loginAs('tecnico1.cooperativa');
    record('login', true, 'Inicio de sesión online como tecnico1 (DEMO) y organización DEMO · Cooperativa', shot('mi-jornada'));
  },
  async descargar() {
    await tap(/Descargar datos asignados/);
    const n = await waitFor(/parcela\(s\) autorizadas descargadas/, { timeout: 30000 });
    state.plots = Number(/(\d+) parcela/.exec(n.text || n.desc)?.[1] ?? 0);
    state.deviceId = sql(`select id from devices where label = 'Terra Link Campo' order by registered_at desc limit 1`); save();
    record('descargar-asignaciones', state.plots > 0, `${state.plots} parcela(s) autorizadas descargadas`, shot('descarga'));
  },
  async capturar() {
    const tok = await login('tecnico1.cooperativa');
    const org = await coopId(tok);
    const plots = (await api(`/api/v1/organizations/${org}/plots?status=ACTIVE&limit=100`, { token: tok })).data.items;
    state.plot = plots[0]; save();
    await tap(/^Nueva captura$/);
    await tap(new RegExp(`^${state.plot.plot_code} ·`));
    await waitFor(/Captura · /);
    const antes = await ubicacionMiUbicacion();
    record('capturar-ubicacion', /Precisión/.test(antes) && !/Ubicación guardada en el borrador/.test(antes), `Mi ubicación EMULADA en ${state.plot.plot_code}: la lectura se mostró SIN guardar (el borrador seguía «Sin ubicación.») y solo se guardó con «Usar esta ubicación en el borrador»`, shot('ubicacion'));
  },
  async foto() {
    await tap(/^Tomar foto$/);
    for (let i = 0; i < 40; i++) {
      const t = allText();
      if (/Foto copiada al almacenamiento|Archivo procesado por la app/.test(t)) break;
      const allow = find(/^(ALLOW|Allow|WHILE USING THE APP|While using the app|NEXT|Next|OK|Got it)$/i); if (allow.length) { tapNode(allow[0]); await sleep(800); continue; }
      const done = find(/done_button|^Done$|^OK$/); if (done.length) { tapNode(done[0]); await sleep(1500); continue; }
      const shutter = find(/shutter_button|^Shutter$/); if (shutter.length) { tapNode(shutter[0]); await sleep(2500); continue; }
      await sleep(1000);
    }
    await waitFor(/Foto copiada al almacenamiento|Archivo procesado por la app/, { timeout: 20000 });
    record('foto', true, 'Foto de la cámara VIRTUAL del emulador (escena sintética); metadatos quitados por la app', shot('foto'));
  },
  async guardarOffline() {
    await proxy('offline');
    await typeInto(/Observación de campo/, 'Prueba emulador sintetica');
    hideKeyboard(); await sleep(500);
    await tap(/^Guardar en cola$/);
    await waitFor(/Pendientes/);
    const t = await pendingText();
    state.ops = opIdsShown(t); save();
    record('guardar-offline', /Pendiente \(en cola\)/.test(t) && state.ops.length >= 2, { modo_red: 'offline (proxy)', operaciones: state.ops }, shot('pendientes-offline'));
  },
  async cierreForzado() {
    await restart();
    await waitFor(/Elige la organización/, { timeout: 30000 });
    await tap(/DEMO · Cooperativa/);
    await waitFor(/Mi jornada/);
    const t = await pendingText();
    const ids = opIdsShown(t);
    record('cierre-forzado-y-reapertura', JSON.stringify(ids) === JSON.stringify(state.ops), { antes: state.ops, despues: ids }, shot('tras-reapertura'));
  },
  async cortarTrasCommit() {
    execFileSync('docker', ['compose', 'stop', 'scanner'], { cwd: root });
    await proxy('cortar-tras-commit');
    await tab('Inicio');
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización (detenida|terminada)/, { timeout: 60000 });
    const t1 = allText();
    const full = sql(`select operation_id from sync_operations where device_id = '${state.deviceId}' order by received_at desc limit 2`).split('\n').filter(Boolean);
    state.fullOps = full; save();
    const locCount = sql(`select count(*) from location_samples where operation_id in (${full.map((x) => `'${x}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})`);
    record('interrupcion-tras-commit', /detenida/.test(t1), { respuesta_cortada: true, operaciones_confirmadas_en_servidor: full.length, muestras_creadas: Number(locCount) }, shot('sync-cortada'));
    await sleep(1000);
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización terminada/, { timeout: 60000 });
    const after = sql(`select count(*) from location_samples where operation_id in (${full.map((x) => `'${x}'`).join(',')})`);
    const syncRows = sql(`select count(*) from sync_operations where operation_id in (${full.map((x) => `'${x}'`).join(',')})`);
    const t2 = await pendingText();
    const ids = opIdsShown(t2);
    record('reintento-sin-duplicar', Number(after) === Number(locCount) && Number(syncRows) === full.length && JSON.stringify(ids) === JSON.stringify(state.ops),
      { muestras_tras_reintento: Number(after), filas_sync: Number(syncRows), ids_mostrados: ids, mismos_ids: JSON.stringify(ids) === JSON.stringify(state.ops) }, shot('sync-reintento'));
  },
  async fotoAnalisis() {
    const t = await pendingText();
    const pend = /análisis pendiente/.test(t);
    const tok = await login('tecnico1.cooperativa');
    const org = await coopId(tok);
    const doc = sql(`select u.document_id || '|' || u.version_id from sync_attachment_uploads u where u.device_id = '${state.deviceId}' order by u.uploaded_at desc limit 1`);
    const [docId, verId] = doc.split('|');
    const view1 = (await api(`/api/v1/organizations/${org}/documents/${docId}`, { token: tok })).data;
    const v1 = view1.versions.find((v) => v.id === verId);
    record('foto-sin-analisis-no-disponible', pend && v1.availability === 'SCAN_FAILED' && v1.downloadable === false, { app: pend ? 'archivo recibido, análisis pendiente' : 'otro', documentos: v1.availability, descargable: v1.downloadable, tipo: view1.document_type }, shot('foto-analisis-pendiente'));
    execFileSync('docker', ['compose', 'start', 'scanner'], { cwd: root });
    for (let i = 0; i < 40 && !/healthy/.test(execFileSync('docker', ['compose', 'ps', 'scanner', '--format', '{{.Status}}'], { cwd: root, encoding: 'utf8' })); i++) await sleep(3000);
    const retry = await api(`/api/v1/organizations/${org}/documents/${docId}/versions/${verId}/scan`, { method: 'POST', token: tok });
    await tab('Inicio');
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización terminada/, { timeout: 60000 });
    const t2 = await pendingText();
    const v2 = (await api(`/api/v1/organizations/${org}/documents/${docId}`, { token: tok })).data.versions.find((v) => v.id === verId);
    record('foto-disponible-tras-analisis', retry.status === 200 && v2.availability === 'AVAILABLE' && /archivo disponible en el servidor/.test(t2), { reintento_analisis: retry.status, documentos: v2.availability, app: /archivo disponible en el servidor/.test(t2) ? 'archivo disponible en el servidor' : 'otro' }, shot('foto-disponible'));
  },
  async conflicto() {
    await tab('Inicio');
    await tap(/^Nueva captura$/);
    await tap(new RegExp(`^${state.plot.plot_code} ·`));
    await waitFor(/Captura · /);
    adb('emu', 'geo', 'fix', '-80.1602', '-0.8480');
    await ubicacionMiUbicacion();
    await proxy('offline');
    await tap(/^Guardar en cola$/);
    await waitFor(/Pendientes/);
    // edición «web»: el administrador registra una ubicación por la API pública que usa la web (versión de la parcela +1)
    const adm = await login('admin.cooperativa');
    const org = await coopId(adm);
    const p = (await api(`/api/v1/organizations/${org}/plots/${state.plot.id}`, { token: adm })).data;
    const web = await api(`/api/v1/organizations/${org}/plots/${state.plot.id}/location-samples`, { method: 'POST', token: adm, body: { expected_version: Number(p.row_version), operation_id: crypto.randomUUID(), source: 'BROWSER_GEOLOCATION', latitude: -0.85, longitude: -80.16, accuracy_m: null, captured_at: new Date().toISOString() } });
    await proxy('pass');
    await tab('Inicio');
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización (terminada|detenida)/, { timeout: 60000 });
    const t = await pendingText();
    record('conflicto-visible', web.status === 201 && /Conflicto/.test(t) && /Reenviar sobre la versión actual del servidor/.test(t), { edicion_web_http: web.status, version_servidor: web.data?.plot_row_version }, shot('conflicto'));
    await tap(/Reenviar sobre la versión actual del servidor/);
    await sleep(1500);
    await tab('Inicio');
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización terminada/, { timeout: 60000 });
    const t2 = await pendingText();
    const rows = sql(`select status || ':' || coalesce(resolves_operation_id::text,'-') from sync_operations where operation_type = 'PLOT_LOCATION_SAMPLE_CREATE' and device_id = '${state.deviceId}' order by received_at desc limit 2`);
    record('conflicto-resuelto', /resuelta con otra operación/.test(t2) && /ACCEPTED:[0-9a-f-]{36}/.test(rows) && /CONFLICT:-/.test(rows), { servidor: rows.split('\n') }, shot('conflicto-resuelto'));
  },
  async cambioCuenta() {
    const t = await logout();
    record('cerrar-sesion-avisa', /captura\(s\) sin enviar|No hay capturas pendientes/.test(t), /sin enviar/.test(t) ? 'aviso de capturas sin enviar' : 'sin pendientes', null);
    await loginAs('tecnico2.cooperativa');
    const t2 = await pendingText();
    record('otra-cuenta-no-ve', /No hay capturas en este dispositivo/.test(t2) && !/Prueba emulador/.test(t2), 'tecnico2 no ve capturas de tecnico1', shot('tecnico2-sin-capturas'));
    await logout();
    await loginAs('tecnico1.cooperativa');
    const t3 = await pendingText();
    record('misma-cuenta-recupera', opIdsShown(t3).length >= 2, { operaciones: opIdsShown(t3).length }, shot('tecnico1-recupera'));
  },
  async vencimiento() {
    adb('root'); await sleep(3000);
    adb('wait-for-device'); adb('reverse', 'tcp:4000', 'tcp:4001'); // `adb root` reinicia adbd y pierde el reverse
    adb('shell', 'settings', 'put', 'global', 'auto_time', '0');
    const now = new Date(Date.now() + 2 * 3600_000);
    // El emulador usa UTC: formatear en UTC (no en la hora local del equipo).
    const fmt = (d) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${d.getUTCFullYear()}.${String(d.getUTCSeconds()).padStart(2, '0')}`;
    adb('shell', 'date', fmt(now));
    await restart(); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    const t = allText();
    const t2 = await pendingText();
    record('sesion-vencida-bloquea-sin-borrar', /Captura bloqueada/.test(t) && /venció/.test(t) && opIdsShown(t2).length >= 2, 'reloj del emulador +2 h: captura bloqueada; pendientes visibles', shot('sesion-vencida'));
    adb('shell', 'date', fmt(new Date(Date.now() - 24 * 3600_000)));
    await restart(); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    const t3 = allText();
    record('reloj-atrasado-bloquea', /retrocedió/.test(t3), 'reloj del emulador −1 día: bloqueo por reloj atrasado', shot('reloj-atrasado'));
    adb('shell', 'date', fmt(new Date()));
    adb('shell', 'settings', 'put', 'global', 'auto_time', '1');
    await restart();
  },
  async almacenamientoLleno() {
    await tap(/DEMO · Cooperativa/, { timeout: 15000 }).catch(() => undefined);
    // Precondición: sesión vigente sin bloqueo de reloj (tras «vencimiento» hay que volver a iniciar sesión).
    await logout().catch(() => undefined); await loginAs('tecnico1.cooperativa'); // siempre: el botón deshabilitado no se distingue por texto
    await tab('Inicio').catch(() => undefined);
    const borradores = () => Number(/(\d+) borrador\(es\) local\(es\)/.exec(allText())?.[1] ?? NaN);
    await waitFor(/borrador\(es\) local\(es\)/, { scrollTo: true });
    const n0 = borradores();
    const enCola = () => Number(/(\d+) captura\(s\) en cola/.exec(allText())?.[1] ?? NaN);
    const q0 = enCola();
    await restart(); const org0 = await waitFor(/Elige la organización|Mi jornada/, { timeout: 30000 }); if (/Elige/.test(org0.text + org0.desc)) { await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/); } // sin captura abierta en memoria
    await tab('Captura'); await waitFor(new RegExp('^' + state.plot.plot_code + ' ·'), { scrollTo: true }); // lista de parcelas, antes de llenar el disco
    const free = Number(adb('shell', 'df', '-k', '/data').split('\n')[1].trim().split(/\s+/)[3]);
    const fillMb = Math.max(0, Math.floor(free / 1024) - 3);
    // Llenado CONTROLADO: el disco de datos del emulador puede crecer en el equipo (C:). Se exige margen antes, se rellena por
    // tramos de ≤1 GB midiendo C: tras cada uno y se aborta (y se borra el relleno) si C: baja de 10 GB.
    const hostGb = () => { const st = statfsSync('C:/'); return (st.bavail * st.bsize) / 1024 ** 3; };
    const hostBefore = hostGb();
    if (hostBefore < 12) throw new Error(`C: con ${hostBefore.toFixed(2)} GB libres (< 12 GB): no se rellena el emulador`);
    let part = 0; let left = fillMb - 64; let hostMin = hostBefore;
    const chunks = [];
    while (left > 0) { const mb = Math.min(1024, left); chunks.push(mb); left -= mb; }
    chunks.push(32, 16, 8, 4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625); // hasta 16 KB: sin margen, una escritura pequeña de la base ya necesita un bloque nuevo; bloques reservados: los tramos que no caben se ignoran
    for (const mb of chunks) {
      try { adb('shell', 'fallocate', '-l', `${Math.round(mb * 1024)}K`, `/data/local/tmp/tl-relleno-${part}`); part += 1; } catch { /* no cabe */ }
      hostMin = Math.min(hostMin, hostGb());
      if (hostMin < 10) { adb('shell', 'rm -f /data/local/tmp/tl-relleno-*'); throw new Error(`C: bajó a ${hostMin.toFixed(2)} GB durante el relleno: abortado y relleno borrado`); }
    }
    state.hostDisk = { antes_GB: +hostBefore.toFixed(2), minimo_GB: +hostMin.toFixed(2) };
    let ok = false; let s = null; let fase = 'borrador';
    try {
      await tap(new RegExp(`^${state.plot.plot_code} ·`));
      // Con el disco lleno puede fallar ya la creación del borrador (mensaje en español) o, si cabe, la foto.
      const first = await waitFor(/Captura · |No hay espacio libre/);
      if (/Captura · /.test(`${first.text} ${first.desc}`)) {
      // El borrador cupo: se intenta escribir DENTRO de la app (nota + «Guardar en cola», que escribe la operación). La cámara del sistema
      // es otra aplicación y con el disco lleno falla por su cuenta, así que no sirve para probar el mensaje de Terra Link.
      fase = 'cola';
      // La nota se escribe al salir del campo (`onEndEditing` → `store.setNote`): ahí ocurre la escritura que no cabe.
      await typeInto(/Observación de campo/, 'nota con disco lleno'); hideKeyboard(); await sleep(600);
      // «Guardar en cola» escribe la nota y la operación (`setNote` + `enqueue`): con el disco sin un bloque libre debe fallar con mensaje en español.
      await ver(/^Guardar en cola$/, 25000); await tap(/^Guardar en cola$/);
      for (let i = 0; i < 20 && !/5 MB libres|No hay espacio/.test(allText()); i++) await sleep(1000);
      }
      const t = allText();
      // Correcto solo con mensaje en español y sin error técnico de SQLite.
      ok = /5 MB libres|No hay espacio/.test(t) && !/database or disk is full|NativeStatement/.test(t);
      s = shot('almacenamiento-lleno-inducido');
    } finally {
      adb('shell', 'rm -f /data/local/tmp/tl-relleno-*'); // siempre, también si el paso falla
    }
    // Sin escrituras parciales: tras liberar el espacio, los borradores son los de antes (más el abierto, si llegó a crearse) y nada quedó a medias.
    await sleep(1500); await tab('Inicio'); await waitFor(/borrador\(es\) local\(es\)/, { scrollTo: true });
    const n1 = borradores(); const q1 = enCola();
    // Sin escrituras parciales: el borrador abierto existe (+1) pero la cola NO creció (la operación que no cupo no quedó a medias) y lo anterior sigue.
    const sinParciales = (fase === 'borrador' ? n1 === n0 : n1 === n0 + 1) && q1 === q0;
    ok = ok && sinParciales; state.borradores = { antes: n0, despues: n1, en_cola_antes: q0, en_cola_despues: q1, fase }; save();
    record('almacenamiento-lleno-inducido', ok, `FALLO INDUCIDO en emulador, fase ${fase} (archivo de relleno de ${fillMb} MB, después borrado; C: ${JSON.stringify(state.hostDisk)}); no es falta real de espacio`, s);
  },
  /** La sesión del servidor dura 1 h (ADR-0005): una tanda larga debe volver a iniciar sesión con conexión antes de seguir. */
  async relogin() {
    await proxy('pass'); await restart();
    const first = await waitFor(/Elige la organización|Iniciar sesión/, { timeout: 40000 });
    if (/Elige/.test(first.text + first.desc)) { await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/); await logout(); }
    await loginAs('tecnico1.cooperativa');
    record('relogin', true, 'Nuevo inicio de sesión online (la anterior vencía a la hora)', null);
  },
  // ── Altas sin conexión, mapa y recorridos nuevos (2026-10-28) ──────────────────────────────────────────────────────────
  async altasPreparar() {
    const adm = await login('admin.cooperativa'); const org = await coopId(adm);
    const mid = sql("select m.id from memberships m join users u on u.id = m.user_id where u.email like 'tecnico1.cooperativa@%' and m.organization_id = '" + org + "' limit 1");
    let pid = sql("select id from producers where organization_id = '" + org + "' and producer_code = 'MOV-SIN-PARC'");
    if (!pid) { const r = await api('/api/v1/organizations/' + org + '/producers', { method: 'POST', token: adm, body: { producer_code: 'MOV-SIN-PARC', legal_name: 'Productor movil sin parcelas (DEMO)', assigned_membership_id: mid } }); pid = r.data?.id ?? ''; }
    state.sinParc = { id: pid, org }; save();
    record('altas-preparar-productor-sin-parcelas', !!pid, { productor: pid, asignado_a_tecnico1: true, nota: 'Registro DEMO creado por la API pública (sin seed ni restablecimiento); no tiene parcelas' });
  },
  async altasSinParcelas() {
    await proxy('pass'); await tab('Inicio');
    await tap(/Descargar datos asignados/); await waitFor(/parcela\(s\) autorizadas descargadas/, { timeout: 30000 });
    await tab('Altas');
    await ver(/MOV-SIN-PARC/);
    record('altas-productor-autorizado-sin-parcelas-visible', true, 'Tras la descarga, «Nueva parcela» ofrece MOV-SIN-PARC aunque no tiene parcelas', shot('altas-productor-sin-parcelas'));
    await proxy('offline');
    await tap(/MOV-SIN-PARC/);
    state.plotCode = 'MOV-P-' + (Date.now() % 1000000); save();
    await typeInto(/^Código de la parcela$/, state.plotCode); hideKeyboard();
    await tap(/^Guardar parcela como borrador local$/); await ver(/Parcela guardada como borrador local/);
    await tap(/^Poner el alta en cola$/); await ver(/Alta de la parcela en cola/);
    record('altas-primera-parcela-offline-en-cola', true, { codigo: state.plotCode, red: 'offline (proxy)' }, shot('altas-parcela-en-cola'));
  },
  async altasCaptura() {
    await abrirCaptura(state.plotCode);
    const sinMapa = allText();
    record('mapa-sin-cartografia-dice-que-falta', /Sin cartografía preparada/.test(sinMapa) && /No hay cartografía preparada/.test(sinMapa), 'Antes de preparar la zona el mapa declara que no hay cartografía y sigue dibujando puntos', shot('mapa-sin-cartografia'));
    const geo = [['-80.1601', '-0.8479'], ['-80.1598', '-0.8476'], ['-80.1594', '-0.8480'], ['-80.1598', '-0.8484']];
    adb('emu', 'geo', 'fix', ...geo[0]);
    const antes = await ubicacionMiUbicacion();
    for (const g of geo.slice(1)) {
      adb('emu', 'geo', 'fix', ...g); await sleep(1500);
      await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
      if (g === geo[1]) record('mapa-lectura-sin-guardar', true, 'La lectura se muestra en el mapa con su precisión y el vértice solo se agrega con la acción explícita', shot('mapa-lectura'));
      await ver(/^Añadir vértice con la lectura/, 30000); await tap(/^Añadir vértice con la lectura/); await ver(/Vértice añadido al borrador/);
    }
    record('mapa-vertices-revision', true, { vertices: 3, ubicacion_guardada: true, nota: antes.includes('Precisión') }, shot('mapa-vertices'));
    await tap(/^Guardar en cola$/); await waitFor(/Pendientes/);
    const t = await pendingText();
    record('altas-captura-en-cola', /Alta de parcela/.test(t) || /Vértice/.test(t), 'Ubicación y 3 vértices sobre la parcela NUEVA en cola', shot('altas-pendientes'));
  },
  async altasReaperturaYSync() {
    await restart(); await waitFor(/Elige la organización/, { timeout: 30000 }); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    const t = await pendingText();
    const sobrevive = /Vértice 1/.test(t) && /Vértice 3/.test(t);
    record('altas-reapertura-conserva-cola', sobrevive, 'Tras cierre forzado y reapertura la captura sobre la parcela local sigue en cola', shot('altas-tras-reapertura'));
    await proxy('pass'); await tab('Inicio');
    await tap(/Sincronizar ahora/); await waitFor(/Sincronización terminada/, { timeout: 90000 });
    const q = (x) => sql(x).trim();
    const plot = q("select id || '|' || producer_id from plots where organization_id = '" + state.sinParc.org + "' and plot_code = '" + state.plotCode + "'");
    const [pid, prod] = plot.split('|');
    const verts = Number(q("select count(*) from draft_vertices v join polygon_drafts d on d.id = v.draft_id where d.plot_id = '" + pid + "'"));
    const locs = Number(q("select count(*) from location_samples where plot_id = '" + pid + "'"));
    record('altas-sync-en-dependencia', !!pid && prod === state.sinParc.id && verts === 3 && locs >= 1, { parcela_definitiva: pid, productor_correcto: prod === state.sinParc.id, vertices_en_borrador: verts, muestras: locs }, shot('altas-sincronizado'));
    await tap(/Sincronizar ahora/); await waitFor(/Sincronización terminada/, { timeout: 60000 });
    const plots2 = Number(q("select count(*) from plots where organization_id = '" + state.sinParc.org + "' and plot_code = '" + state.plotCode + "'"));
    const verts2 = Number(q("select count(*) from draft_vertices v join polygon_drafts d on d.id = v.draft_id where d.plot_id = '" + pid + "'"));
    record('altas-reintento-sin-duplicar', plots2 === 1 && verts2 === 3, { parcelas: plots2, vertices: verts2 });
  },
  async mapaPreparar() {
    adb('reverse', 'tcp:8090', 'tcp:8090');
    await abrirCaptura(state.plotCode);
    // Sin ningún punto no hay zona que preparar (el botón está deshabilitado): primero una lectura de «Mi ubicación» (sin guardar).
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
    await ver(/^Preparar cartografía de esta zona/, 30000); await tap(/^Preparar cartografía de esta zona/);
    await ver(/Cartografía preparada: \d+ teselas/, 180000);
    const t = allText();
    state.mapa = { texto: /Cartografía preparada: (\d+) teselas \(([\d.]+) MB\)/.exec(t)?.slice(1) }; save();
    record('mapa-cartografia-preparada', /Cartografía preparada/.test(t), { teselas_mb: state.mapa.texto, origen: 'servicio maps del propio despliegue (localhost:8090 por adb reverse)' }, shot('mapa-preparado'));
  },
  async mapaOffline() {
    adb('reverse', '--remove', 'tcp:8090');
    await proxy('offline');
    await restart(); await waitFor(/Elige la organización/, { timeout: 30000 }); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    await abrirCaptura(state.plotCode);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
    await ver(/Cartografía preparada/); scroll('up'); scroll('up'); scroll('up'); await sleep(4000);
    record('mapa-offline-con-cartografia-local', true, 'Sin red ni servicio de mapas (reverse 8090 retirado, API cortada): el mapa dibuja el fondo desde la base cifrada de la cuenta', shot('mapa-offline'));
    await proxy('pass');
  },
  async ubicacionDenegada() {
    // Precondición: sesión vigente. Se parte de una captura con trabajo previo (nota) para comprobar que NADA de lo anterior se pierde.
    const borradores = () => Number(/(\d+) borrador\(es\) local\(es\)/.exec(allText())?.[1] ?? NaN);
    await tab('Inicio'); await waitFor(/borrador\(es\) local\(es\)/, { scrollTo: true }); const n0 = borradores();
    // Revocar un permiso en ejecución hace que Android cierre la app: se revoca ANTES de abrirla de nuevo.
    adb('shell', 'pm', 'revoke', PKG, 'android.permission.ACCESS_FINE_LOCATION');
    adb('shell', 'pm', 'revoke', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    await abrirCaptura(state.plot.plot_code);
    await typeInto(/Observación de campo/, 'trabajo previo conservado'); hideKeyboard(); await sleep(800);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/);
    // Con el permiso revocado el sistema pregunta: se NIEGA (no se concede).
    let dialogo = false;
    for (let i = 0; i < 25 && !/Permiso de ubicación denegado/.test(allText()); i++) {
      const deny = find(/permission_deny_button|permission_deny_and_dont_ask_again_button|^(Don.t allow|DENY|No permitir)$/i);
      if (deny.length) { dialogo = true; tapNode(deny[0]); await sleep(1500); continue; }
      await sleep(1000);
    }
    await ver(/Permiso de ubicación denegado/, 20000);
    const t = allText();
    const explicado = /Permiso de ubicación denegado/.test(t) && /se conservan/.test(t);
    const sinLectura = !/Lectura de «Mi ubicación» \(todavía no guardada\)/.test(t);
    const shotDenegada = shot('ubicacion-denegada-mensaje');
    // El trabajo anterior sigue: la nota y el borrador; y no se escribió ninguna ubicación.
    await ver(/Ubicación/, 20000);
    const sinUbicacion = /Sin ubicación\./.test(allText()) || (await ver(/Sin ubicación\./, 20000).then(() => true).catch(() => false));
    await restart(); await waitFor(/Elige la organización/, { timeout: 30000 }); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    await tab('Inicio'); await waitFor(/borrador\(es\) local\(es\)/, { scrollTo: true }); const n1 = borradores();
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_FINE_LOCATION');
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    record('ubicacion-denegada-conserva-borrador', explicado && sinLectura && sinUbicacion && n1 === n0 + 1,
      { dialogo_del_sistema_negado: dialogo, mensaje_explica_y_conserva: explicado, sin_lectura_mostrada: sinLectura, sin_ubicacion_escrita: sinUbicacion, borradores: { antes: n0, despues_de_reabrir: n1 } }, shotDenegada);
  },
  // ── Cierre acotado de ubicación denegada y almacenamiento lleno (2026-10-29): se compara CONTENIDO, no solo recuentos ──────────────────
  async ubicacionDenegadaContenido() {
    // Trabajo previo REAL (un vértice guardado con el permiso concedido); se revoca el permiso (Android cierra la app), se reabre ESE borrador y se
    // comprueba: mensaje explicativo, vértice idéntico, ninguna ubicación ni vértice nuevos.
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_FINE_LOCATION'); adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    await abrirCaptura(state.plot.plot_code);
    adb('emu', 'geo', 'fix', '-80.1604', '-0.8484'); await sleep(1200);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
    await ver(/^Añadir vértice con la lectura/, 30000); await tap(/^Añadir vértice con la lectura/); await sleep(2500); /* el aviso puede quedar fuera de la vista: el resultado se comprueba por CONTENIDO (leerBorrador) */
    const c0 = await leerBorrador();
    await ver(/^Guardar en cola$/, 25000); await tap(/^Guardar en cola$/); await waitFor(/Pendientes/); // el borrador queda en el dispositivo
    adb('shell', 'pm', 'revoke', PKG, 'android.permission.ACCESS_FINE_LOCATION'); adb('shell', 'pm', 'revoke', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    await restart(); const pri = await waitFor(/Elige la organización|Mi jornada/, { timeout: 30000 }); if (/Elige/.test(pri.text + pri.desc)) { await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/); }
    // ese borrador ya está en cola (no editable): se intenta una captura NUEVA sobre la misma parcela con el permiso denegado y se comprueba que lo anterior sigue idéntico
    await abrirCaptura(state.plot.plot_code);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/);
    let dialogo = false;
    for (let i = 0; i < 25; i++) {
      const deny = find(/permission_deny_button|permission_deny_and_dont_ask_again_button|^(Don.t allow|DENY|No permitir)$/i);
      if (deny.length) { dialogo = true; tapNode(deny[0]); await sleep(1500); continue; }
      if (/Permiso de ubicación denegado/.test(allText())) break;
      await sleep(1000);
    }
    const c1 = await leerBorrador();
    const mensaje = /Permiso de ubicación denegado/.test(c1.texto) && /se conservan/.test(c1.texto);
    const sinLectura = !/Lectura de «Mi ubicación» \(todavía no guardada\)/.test(c1.texto);
    await tab('Pendientes'); await sleep(1500); const pend = allText();
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_FINE_LOCATION'); adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    record('ubicacion-denegada-contenido', mensaje && sinLectura && c1.ubicacion === null && c1.vertices.length === 0 && c0.vertices.length === 1,
      { dialogo_del_sistema_negado: dialogo, mensaje_explica_y_conserva: mensaje, sin_lectura_mostrada: sinLectura, trabajo_previo_guardado: c0.vertices, captura_nueva_sin_ubicacion_ni_vertices: c1.ubicacion === null && c1.vertices.length === 0,
        pendientes_conserva_la_captura_previa: /Pendiente \(en cola\)/.test(pend) }, shot('ubicacion-denegada-contenido'));
  },
  async almacenamientoControlado() {
    // Hipótesis: con CERO bloques libres una escritura de Terra Link (añadir un vértice) falla con SQLITE_FULL/ENOSPC; el mensaje es recuperable, el contenido anterior
    // no cambia, no queda un vértice a medias y, al liberar espacio, la misma acción funciona. Se compara el CONTENIDO (coordenadas), no recuentos.
    adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_FINE_LOCATION'); adb('shell', 'pm', 'grant', PKG, 'android.permission.ACCESS_COARSE_LOCATION');
    await abrirCaptura(state.plot.plot_code);
    adb('emu', 'geo', 'fix', '-80.1600', '-0.8480'); await sleep(1200);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
    await ver(/^Añadir vértice con la lectura/, 30000); await tap(/^Añadir vértice con la lectura/); await sleep(2500); /* el aviso puede quedar fuera de la vista: el resultado se comprueba por CONTENIDO (leerBorrador) */
    const c0 = await leerBorrador();
    adb('emu', 'geo', 'fix', '-80.1596', '-0.8476'); await sleep(1200);
    await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
    const hostGb = () => { const st = statfsSync('C:/'); return (st.bavail * st.bsize) / 1024 ** 3; };
    if (hostGb() < 12) throw new Error('C: con menos de 12 GB libres: no se rellena el emulador');
    adb('logcat', '-c');
    let part = 0; const libreKb = () => Number(adb('shell', 'df', '-k', '/data').split('\n').filter((l) => /\/data/.test(l)).pop().trim().split(/\s+/)[3]);
    try {
      for (const kb of [1048576, 1048576, 1048576, 1048576, 524288, 262144, 131072, 65536, 32768, 16384, 8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16, 8, 4]) {
        for (let i = 0; i < 6; i++) { try { adb('shell', 'fallocate', '-l', kb + 'K', '/data/local/tmp/tl-relleno-' + (part++)); } catch { break; } if (kb >= 4096 && libreKb() < kb) break; }
        if (hostGb() < 10) throw new Error('C: bajó de 10 GB durante el relleno');
      }
      const libre = libreKb();
      await ver(/^Añadir vértice con la lectura/, 30000); await tap(/^Añadir vértice con la lectura/);
      for (let i = 0; i < 20 && !/5 MB libres|No hay espacio/.test(allText()); i++) await sleep(1000);
      const c1 = await leerBorrador();
      const t = c1.texto;
      const mensaje = /No hay espacio libre en el dispositivo para guardar este cambio/.test(t); const tecnico = /database or disk is full|NativeStatement|SQLITE_FULL/.test(t);
      const pid = adb('shell', 'pidof', PKG).trim().split(/\s+/)[0];
      const log = adb('logcat', '-d').split('\n').filter((l) => /disk is full|ENOSPC|SQLITE_FULL|No space left/i.test(l)).filter((l) => !pid || l.includes(' ' + pid + ' ')).slice(0, 3).map((l) => l.slice(0, 200));
      const igual = JSON.stringify(c1.vertices) === JSON.stringify(c0.vertices) && c1.ubicacion === c0.ubicacion;
      const sh = shot('almacenamiento-controlado-fallo');
      adb('shell', 'rm -f /data/local/tmp/tl-relleno-*');
      await sleep(1500);
      await ver(/^Mi ubicación$/, 60000); await tap(/^Mi ubicación$/); await ver(/Lectura de «Mi ubicación» \(todavía no guardada\)/, 90000);
      await ver(/^Añadir vértice con la lectura/, 30000); await tap(/^Añadir vértice con la lectura/); await sleep(2500); /* el aviso puede quedar fuera de la vista: el resultado se comprueba por CONTENIDO (leerBorrador) */
      const c2 = await leerBorrador();
      const recupera = c2.vertices.length === c0.vertices.length + 1 && JSON.stringify(c2.vertices.slice(0, c0.vertices.length)) === JSON.stringify(c0.vertices);
      record('almacenamiento-lleno-controlado', mensaje && !tecnico && igual && recupera,
        { libre_kb_antes_de_escribir: libre, mensaje_en_espanol: mensaje, sin_error_tecnico_en_pantalla: !tecnico, error_real_de_android_en_logcat_del_proceso_de_la_app: log, pid_app: pid, contenido_antes: { ubicacion: c0.ubicacion, vertices: c0.vertices }, contenido_tras_el_fallo: { ubicacion: c1.ubicacion, vertices: c1.vertices }, contenido_igual: igual, tras_liberar: { ubicacion: c2.ubicacion, vertices: c2.vertices }, recupera_sin_duplicar: recupera, nota: 'FALLO REAL de almacenamiento provocado en el emulador con relleno hasta cero bloques; no es una simulación del arnés' }, sh);
    } finally { adb('shell', 'rm -f /data/local/tmp/tl-relleno-*'); }
  },
  async adjuntoInterrumpido() {
    await proxy('pass'); await restart(); await waitFor(/Elige la organización/, { timeout: 30000 }); await tap(/DEMO · Cooperativa/); await waitFor(/Mi jornada/);
    await abrirCaptura(state.plot.plot_code);
    await tap(/^Tomar foto$/);
    for (let i = 0; i < 40; i++) {
      const t = allText();
      if (/Foto copiada al almacenamiento|Archivo procesado por la app/.test(t)) break;
      const allow = find(/^(ALLOW|Allow|WHILE USING THE APP|While using the app|NEXT|Next|OK|Got it)$/i); if (allow.length) { tapNode(allow[0]); await sleep(800); continue; }
      const done = find(/done_button|^Done$|^OK$/); if (done.length) { tapNode(done[0]); await sleep(1500); continue; }
      const shutter = find(/shutter_button|^Shutter$/); if (shutter.length) { tapNode(shutter[0]); await sleep(2500); continue; }
      await sleep(1000);
    }
    await tap(/^Guardar en cola$/); await waitFor(/Pendientes/);
    await proxy('cortar-subida'); await tab('Inicio');
    await tap(/Sincronizar ahora/); await waitFor(/Sincronización (detenida|terminada)/, { timeout: 90000 });
    const t1 = await pendingText();
    record('adjunto-interrumpido-queda-pendiente', /archivo pendiente de subir|análisis pendiente|archivo recibido/.test(t1), { estado_mostrado: /archivo pendiente de subir/.test(t1) ? 'archivo pendiente de subir' : /análisis pendiente/.test(t1) ? 'análisis pendiente' : 'otro' }, shot('adjunto-interrumpido'));
    await tab('Inicio'); await tap(/Sincronizar ahora/); await waitFor(/Sincronización terminada/, { timeout: 90000 });
    const t2 = await pendingText();
    record('adjunto-reintento-sin-duplicar', /archivo (disponible|recibido)|análisis pendiente/.test(t2), 'Tras el reintento el archivo queda recibido una sola vez (estado separado del registro)', shot('adjunto-reintento'));
  },
  async revocacion() {
    await tab('Inicio');
    const adm = await login('admin.cooperativa');
    const org = await coopId(adm);
    const devs = (await api(`/api/v1/organizations/${org}/devices`, { token: adm })).data.filter((d) => d.id === state.deviceId && d.status === 'ACTIVE');
    for (const d of devs) await api(`/api/v1/organizations/${org}/devices/${d.id}/revoke`, { method: 'POST', token: adm, body: { reason: 'Prueba de revocación en emulador' } });
    await tap(/Sincronizar ahora/);
    await waitFor(/Sincronización detenida/, { timeout: 60000 });
    const t = allText();
    record('dispositivo-revocado', /revocado/.test(t), { revocados: devs.length }, shot('revocado'));
  },
};

for (const name of process.argv.slice(2)) {
  try { if (!['preparar', 'relogin', 'vencimiento', 'foto', 'guardarOffline'].includes(name)) await tab('Inicio').catch(() => undefined); await steps[name](); } catch (e) { record(name, false, `excepción: ${(e).message}`, (() => { try { return shot(`fallo-${name}`); } catch { return null; } })()); }
}
