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
    await tap(/^Capturar ubicación$/);
    await waitFor(/Ubicación guardada en el borrador|Lat -?[0-9]/, { timeout: 90000 }); // arranque en frío del proveedor fused
    record('capturar-ubicacion', true, `Muestra de ubicación EMULADA en ${state.plot.plot_code}`, shot('ubicacion'));
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
    await tap(/^Capturar ubicación$/);
    await waitFor(/Ubicación guardada en el borrador|Lat -?[0-9]/, { timeout: 90000 }); // arranque en frío del proveedor fused
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
    await tab('Inicio').catch(() => undefined); // precondición: pestaña Inicio
    await waitFor(/^Nueva captura$/, { scrollTo: true });
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
    chunks.push(32, 16, 8, 4, 2, 1); // bloques reservados: los tramos que no caben se ignoran
    for (const mb of chunks) {
      try { adb('shell', 'fallocate', '-l', `${mb}M`, `/data/local/tmp/tl-relleno-${part}`); part += 1; } catch { /* no cabe */ }
      hostMin = Math.min(hostMin, hostGb());
      if (hostMin < 10) { adb('shell', 'rm -f /data/local/tmp/tl-relleno-*'); throw new Error(`C: bajó a ${hostMin.toFixed(2)} GB durante el relleno: abortado y relleno borrado`); }
    }
    state.hostDisk = { antes_GB: +hostBefore.toFixed(2), minimo_GB: +hostMin.toFixed(2) };
    let ok = false; let s = null; let fase = 'borrador';
    try {
      await tap(/^Nueva captura$/);
      await tap(new RegExp(`^${state.plot.plot_code} ·`));
      // Con el disco lleno puede fallar ya la creación del borrador (mensaje en español) o, si cabe, la foto.
      const first = await waitFor(/Captura · |No hay espacio libre/);
      if (/Captura · /.test(`${first.text} ${first.desc}`)) {
      fase = 'foto';
      await tap(/^Tomar foto$/);
      for (let i = 0; i < 30; i++) {
        const t = allText();
        if (/espacio|5 MB libres/.test(t)) break;
        const shutter = find(/shutter_button|^Shutter$/); if (shutter.length) { tapNode(shutter[0]); await sleep(2500); continue; }
        const done = find(/done_button|^Done$/); if (done.length) { tapNode(done[0]); await sleep(1500); continue; }
        await sleep(1000);
      }
      }
      const t = allText();
      // Correcto solo con mensaje en español y sin error técnico de SQLite.
      ok = /5 MB libres|No hay espacio/.test(t) && !/database or disk is full|NativeStatement/.test(t);
      s = shot('almacenamiento-lleno-inducido');
    } finally {
      adb('shell', 'rm -f /data/local/tmp/tl-relleno-*'); // siempre, también si el paso falla
    }
    record('almacenamiento-lleno-inducido', ok, `FALLO INDUCIDO en emulador, fase ${fase} (archivo de relleno de ${fillMb} MB, después borrado; C: ${JSON.stringify(state.hostDisk)}); no es falta real de espacio`, s);
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
  try { await steps[name](); } catch (e) { record(name, false, `excepción: ${(e).message}`, (() => { try { return shot(`fallo-${name}`); } catch { return null; } })()); }
}
