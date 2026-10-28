import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { runSelfTest, type SelfTestCase } from '../adapters/selftest';
import { appVariant, cleanupCacheTemps, encryptionStatus, expoPlatform, expoUploader, probeEncryption, protectedStorageInventory, runtimeEnvironment, writeCacheFile } from '../adapters/expo';
import { apiFetch, expirePreviewSession, isWebPreview, PREVIEW_DOMAIN, previewState, resetPreview, setPreviewScenario, setPreviewStorageFull, type PreviewScenario } from '../adapters/preview';
import { fixtureJpeg, fixtureLocation } from '../core/fixtures';
import { ApiFailure, SessionManager } from '../app/session-manager';
import { EncryptionRequiredError, isStorageFull, storageFullMessage } from '../core/ports';
import type { SyncSummary } from '../core/sync';
import { sessionLimitNotice, type StoredSession } from '../core/session';
import { SERVER_URL_HELP, validateServerUrl } from '../core/server-url';
import { FRESH_MAX_AGE_S, ageSeconds, isFresh, locationErrorMessage, qualityNotice, qualityOf, readingFrom, type Reading } from '../core/ubicacion';
import type { DatasetPlot, DraftView, LocalStore, RecoveryReport } from '../core/store';
import { Badge, Button, Card, Field, Notice, T, s } from './kit';

// Pantallas P0-023 (UX_UI §21): inicio de sesión online → organización → preparación (datos asignados) → captura
// (ubicación, foto, nota) → pendientes (sincronización P0-024) → diagnóstico.
// En la vista previa web, `apiFetch` es el servidor SIMULADO del navegador; en Android es undefined (API real).
const sessions = new SessionManager(expoPlatform, apiFetch);
/** Entorno sin cifrado y solo con fixtures sintéticas (Expo Go o vista previa web): ni cámara ni ubicación reales. */
const synthetic = runtimeEnvironment === 'EXPO_GO_SYNTHETIC' || runtimeEnvironment === 'WEB_PREVIEW_SYNTHETIC';
const SERVER = isWebPreview ? 'servidor SIMULADO' : 'servidor';
const SYNTH_TITLE = isWebPreview ? 'Vista previa web: datos sintéticos' : 'Entorno de prueba sin cifrado';
const reloadPage = () => { (globalThis as { location?: { reload(): void } }).location?.reload(); };
const DEFAULT_API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';
type Tab = 'home' | 'capture' | 'pending' | 'diag';

// Formato fijo de 24 h: «p. m.» seguido del punto de la frase producía «p. m..» y variaba según el motor JS.
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : '—');
const msg = (e: unknown) => (isStorageFull(e) ? storageFullMessage(e) : e instanceof ApiFailure ? e.message : e instanceof Error ? e.message : 'Error inesperado.');

export function Root() {
  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [store, setStore] = useState<LocalStore | null>(null);
  const [recovery, setRecovery] = useState<RecoveryReport | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const insets = useSafeAreaInsets(); // pantalla de borde a borde: las pestañas no quedan bajo la barra de navegación
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState(false);
  const [probe, setProbe] = useState<{ active: boolean; version: string | null } | null>(null);

  useEffect(() => {
    // Build nativo: sin cifrado comprobado no hay inicio de sesión ni almacenamiento (fallo cerrado).
    if (runtimeEnvironment === 'NATIVE_BUILD') void probeEncryption().then(async (r) => { setProbe(r); if (!r.active) console.log(`TL_NEGATIVE ${JSON.stringify({ variant: appVariant, probe: r, inventario: await protectedStorageInventory() })}`); });
    else setProbe({ active: false, version: null });
  }, []);
  useEffect(() => { cleanupCacheTemps(); void Linking.getInitialURL().then((u) => { if (u?.includes('autoprueba')) setSelfTest(true); }); void sessions.load().then((x) => { setSession(x); setBoot(false); }); }, []);
  const chooseOrg = async (s0: StoredSession, id: string) => {
    if (store) await store.close();
    setFatal(null);
    let st: LocalStore;
    try { st = await sessions.openStore(s0, id); } catch (e) { setFatal(e instanceof EncryptionRequiredError ? e.message : msg(e)); return; }
    setRecovery(await st.recover()); // al abrir: operaciones interrumpidas y archivos incompletos
    setStore(st); setOrgId(id); setTab('home');
  };
  const logout = async () => {
    if (store) await store.close();
    await sessions.logout();
    setStore(null); setOrgId(null); setSession(null);
  };

  if (selfTest) return <View style={s.screen}><Header sub="Autoprueba de seguridad" /><ScrollView contentContainerStyle={s.body}><SelfTest /><Button kind="secondary" label="Volver" onPress={() => setSelfTest(false)} /></ScrollView></View>;
  if (boot || !probe) return <View style={s.screen}><Header sub="Cargando…" /></View>;
  if (runtimeEnvironment === 'NATIVE_BUILD' && !probe.active) return (
    <View style={s.screen}><Header sub={appVariant === 'PRUEBA_NEGATIVA_SIN_SQLCIPHER' ? 'APK DE PRUEBA NEGATIVA (sin SQLCipher)' : 'Build nativo'} /><ScrollView contentContainerStyle={s.body}>
      <Notice tone="blocked" title="Almacenamiento protegido no disponible">Este build no pudo inicializar el cifrado de la base local (SQLCipher). Por seguridad no se permite iniciar sesión, descargar datos ni guardar capturas en este dispositivo.</Notice>
    </ScrollView></View>
  );
  if (!session) return <Login onDone={setSession} />;
  if (fatal) return <View style={s.screen}><Header sub={session.email} /><ScrollView contentContainerStyle={s.body}><Notice tone="blocked" title="Almacenamiento protegido no disponible">{fatal}</Notice><Button kind="secondary" label="Volver" onPress={() => setFatal(null)} /></ScrollView></View>;
  if (!orgId || !store) return <OrgPicker session={session} onPick={(id) => void chooseOrg(session, id)} onLogout={() => void logout()} />;
  const org = session.organizations.find((o) => o.organization_id === orgId);
  return (
    <View style={s.screen}>
      <Header sub={`${org?.name ?? ''} · ${session.email}`} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        {tab === 'home' && <Home session={session} orgId={orgId} store={store} recovery={recovery} onCapture={(d) => { setOpenDraft(d); setTab('capture'); }} onSwitch={() => { setOrgId(null); }} onLogout={() => void logout()} />}
        {tab === 'capture' && <Capture session={session} orgId={orgId} store={store} draftId={openDraft} onDraft={setOpenDraft} onQueued={() => { setOpenDraft(null); setTab('pending'); }} />}
        {tab === 'pending' && <Pending store={store} onOpen={(d) => { setOpenDraft(d); setTab('capture'); }} />}
        {tab === 'diag' && <Diagnostics session={session} orgId={orgId} store={store} recovery={recovery} />}
      </ScrollView>
      <View style={[s.tabs, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {([['home', 'Inicio'], ['capture', 'Captura'], ['pending', 'Pendientes'], ['diag', 'Diagnóstico']] as const).map(([k, l]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} accessibilityLabel={l} style={[s.tab, tab === k && { borderTopWidth: 3, borderColor: T.forest }]} onPress={() => setTab(k)}>
            <Text style={[s.tabText, tab === k && { color: T.forest }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Header({ sub }: { sub: string }) {
  const insets = useSafeAreaInsets();
  if (appVariant === 'PRUEBA_NEGATIVA_SIN_SQLCIPHER') sub = `PRUEBA NEGATIVA · ${sub}`;
  return (
    <View style={[s.header, { paddingTop: Math.max(insets.top + 8, 24) }]}>
      <Text accessibilityRole="header" accessibilityLabel="Terra Link" style={s.brand}>TERRA LINK</Text><Text style={s.sub}>{sub}</Text>
      {isWebPreview && <Text style={s.previewBanner}>Vista previa web de la aplicación móvil · servidor SIMULADO · datos sintéticos · sin cifrado</Text>}
    </View>
  );
}

function Login({ onDone }: { onDone: (x: StoredSession) => void }) {
  const [api, setApi] = useState(DEFAULT_API);
  const [email, setEmail] = useState(isWebPreview ? `tecnico@${PREVIEW_DOMAIN}` : '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void sessions.apiUrl(DEFAULT_API).then(setApi); }, []);
  const go = async () => {
    setBusy(true); setError(null);
    if (!validateServerUrl(api).ok) { setError(SERVER_URL_HELP); setBusy(false); return; }
    try { onDone(await sessions.login(api.trim(), email.trim(), password)); setPassword(''); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  return (
    <View style={s.screen}>
      <Header sub="Captura de campo" />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" style={s.h1}>Iniciar sesión</Text>
        {isWebPreview && <Notice tone="review" title={SYNTH_TITLE}>Esta vista no contacta la API de Terra Link: el servidor está simulado en el navegador. Usa una cuenta sintética @{PREVIEW_DOMAIN} y cualquier contraseña (no se guarda ni se envía). Sirve para revisar diseño y navegación; no prueba cifrado, cámara, ubicación ni Android.</Notice>}
        {runtimeEnvironment === 'EXPO_GO_SYNTHETIC' && <Notice tone="review" title="Entorno de prueba sin cifrado">Expo Go no cifra la base local: solo admite fixtures sintéticos (no usa cámara ni ubicación reales) en organizaciones DEMO. Pertenecer a una organización DEMO no vuelve sintética una captura real. El ensayo real se hace con el build nativo cifrado.</Notice>}
        <Notice tone="process" title="Requiere conexión">El inicio de sesión solo funciona con conexión. Podrás capturar sin red mientras siga vigente la sesión emitida por el servidor; al vencer, lo guardado se conserva y para seguir hay que iniciar sesión.</Notice>
        {isWebPreview ? <Text style={s.muted}>Servidor: SIMULADO en el navegador (sin conexión con la API).</Text>
          : <Field label="Servidor (URL de la API)" value={api} onChangeText={setApi} autoCapitalize="none" autoCorrect={false} keyboardType="url" />}
        <Field label="Correo" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
        <Field label="Contraseña" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        {error && <Notice tone="blocked" title="No se pudo iniciar sesión">{error}</Notice>}
        <Button label={busy ? 'Conectando…' : 'Iniciar sesión'} onPress={() => void go()} disabled={busy || !email || !password} />
      </ScrollView>
    </View>
  );
}

function OrgPicker({ session, onPick, onLogout }: { session: StoredSession; onPick: (id: string) => void; onLogout: () => void }) {
  return (
    <View style={s.screen}>
      <Header sub={session.email} />
      <ScrollView contentContainerStyle={s.body}>
        <Text accessibilityRole="header" style={s.h1}>Elige la organización</Text>
        <Text style={s.muted}>Cada organización tiene sus propios datos y capturas en este dispositivo; no se mezclan.</Text>
        {session.organizations.map((o) => <Button key={o.organization_id} kind="secondary" label={`${o.name} · ${o.roles.join(', ')}`} onPress={() => onPick(o.organization_id)} />)}
        {!session.organizations.length && <Notice tone="review">No tienes membresías activas.</Notice>}
        <Button kind="secondary" label="Cerrar sesión" onPress={onLogout} />
      </ScrollView>
    </View>
  );
}

function Home({ session, orgId, store, recovery, onCapture, onSwitch, onLogout }: { session: StoredSession; orgId: string; store: LocalStore; recovery: RecoveryReport | null; onCapture: (d: string | null) => void; onSwitch: () => void; onLogout: () => void }) {
  const [counts, setCounts] = useState<{ drafts: number; queued: number; pending_ops: number; photos: number; conflicts: number; failed: number } | null>(null);
  const [fetched, setFetched] = useState<string | null>(null);
  const [plots, setPlots] = useState(0);
  const [note, setNote] = useState<{ tone: 'valid' | 'blocked'; text: string } | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const gate = sessions.gate(session, orgId);
  const load = useCallback(async () => { setCounts(await store.counts()); setFetched(await store.datasetFetchedAt()); setPlots((await store.plots()).length); }, [store]);
  useEffect(() => { void load(); }, [load]);
  const download = async () => {
    setNote(null);
    try { const n = await sessions.downloadDataset(session, orgId, store, expoUploader); setNote({ tone: 'valid', text: `${n} parcela(s) autorizadas descargadas${isWebPreview ? ' (sintéticas, del servidor SIMULADO)' : ''}.` }); await load(); } catch (e) { setNote({ tone: 'blocked', text: msg(e) }); }
  };
  const pending = (counts?.drafts ?? 0) + (counts?.queued ?? 0);
  const sync = async () => {
    setSyncing(true); setNote(null);
    try { setSummary(await sessions.sync(session, orgId, store, expoUploader)); await load(); } catch (e) { setNote({ tone: 'blocked', text: msg(e) }); } finally { setSyncing(false); }
  };
  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Mi jornada</Text>
      {synthetic && <Notice tone="review" title={SYNTH_TITLE}>Solo fixtures sintéticos: ni cámara ni ubicación reales.{isWebPreview ? ' Descarga y sincronización usan el servidor SIMULADO del navegador.' : ''}</Notice>}
      {gate.allowed && sessionLimitNotice(gate.until, new Date()) && <Notice tone="review" title="La sesión está por vencer">{sessionLimitNotice(gate.until, new Date())!}</Notice>}
      {gate.allowed ? <Notice tone="valid" title="Captura habilitada">{gate.note} Sesión vigente hasta {fmt(gate.until)}.</Notice>
        : <Notice tone="blocked" title="Captura bloqueada">{gate.note}</Notice>}
      {recovery && (recovery.recovered_operations.length > 0 || recovery.incomplete_temp_files.length > 0 || recovery.missing_files.length > 0) &&
        <Notice tone="review" title="Recuperación al abrir">{recovery.recovered_operations.length} operación(es) interrumpida(s) recuperada(s) con la misma identidad; {recovery.incomplete_temp_files.length} copia(s) de foto incompleta(s) descartada(s) (la foto no se había registrado); {recovery.missing_files.length} archivo(s) faltante(s).</Notice>}
      <Card title="Preparación">
        <Text style={s.p}>Parcelas asignadas en el dispositivo: {plots}</Text>
        <Text style={s.muted}>Última descarga: {fmt(fetched)}. Solo se descargan las parcelas que el servidor autoriza a tu cuenta en esta organización.</Text>
        {note && <Notice tone={note.tone}>{note.text}</Notice>}
        <Button kind="secondary" label="Descargar datos asignados (requiere conexión)" onPress={() => void download()} />
      </Card>
      <Card title="Capturas en este dispositivo">
        <Text style={s.p}>{counts?.drafts ?? 0} borrador(es) local(es) · {counts?.queued ?? 0} captura(s) en cola · {counts?.photos ?? 0} foto(s)</Text>
        <Text style={s.muted}>{counts?.pending_ops ?? 0} operación(es) pendiente(s) de envío · {counts?.conflicts ?? 0} conflicto(s) · {counts?.failed ?? 0} rechazada(s)</Text>
        <Button kind="secondary" label={syncing ? 'Sincronizando…' : 'Sincronizar ahora (requiere conexión y sesión vigente)'} disabled={syncing} onPress={() => void sync()} />
        {summary && <Notice tone={summary.stopped ? 'review' : 'valid'} title={`${summary.stopped ? 'Sincronización detenida' : 'Sincronización terminada'}${isWebPreview ? ' (SIMULADA: nada se envió a Terra Link)' : ''}`}>
          {`${summary.synced} confirmada(s) por el ${SERVER} · ${summary.conflicts} en conflicto · ${summary.failed} rechazada(s) · ${summary.still_pending} pendiente(s) · ${summary.uploads} foto(s) subida(s)${summary.upload_errors ? ` · ${summary.upload_errors} foto(s) sin subir` : ''}${summary.pulled ? ` · datos: ${summary.pulled.changes} cambio(s), ${summary.pulled.tombstones} retirada(s)` : ''}${summary.stopped ? `. ${summary.stopped.message}` : ''}`}
        </Notice>}
        <Button label="Nueva captura" disabled={!gate.allowed || plots === 0} onPress={() => onCapture(null)} hint={plots === 0 ? 'Primero descarga las parcelas de tu alcance (asignadas o propias)' : undefined} />
      </Card>
      <Button kind="secondary" label="Cambiar de organización" onPress={onSwitch} />
      {!confirmLogout ? <Button kind="secondary" label="Cerrar sesión" onPress={() => setConfirmLogout(true)} /> : (
        <Card title="¿Cerrar sesión?">
          <Text style={s.p}>{pending > 0 ? `Tienes ${pending} captura(s) sin enviar. Se conservan en este dispositivo para esta cuenta y organización; otra cuenta no las verá. Para enviarlas más adelante tendrás que volver a iniciar sesión con esta cuenta.` : 'No hay capturas pendientes.'}</Text>
          <Button label="Cerrar sesión" onPress={onLogout} />
          <Button kind="secondary" label="Cancelar" onPress={() => setConfirmLogout(false)} />
        </Card>
      )}
    </>
  );
}

function Capture({ session, orgId, store, draftId, onDraft, onQueued }: { session: StoredSession; orgId: string; store: LocalStore; draftId: string | null; onDraft: (d: string) => void; onQueued: () => void }) {
  const [plots, setPlots] = useState<DatasetPlot[]>([]);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // «Mi ubicación»: lectura SIN guardar. El borrador solo cambia con la acción explícita «Usar esta ubicación».
  const [peek, setPeek] = useState<Reading | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!peek) return undefined;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [peek]);
  const gate = sessions.gate(session, orgId);
  const reload = useCallback(async () => {
    setPlots(await store.plots());
    if (draftId) { const d = (await store.drafts()).find((x) => x.id === draftId) ?? null; setDraft(d); setNote(d?.note ?? ''); } else setDraft(null);
  }, [store, draftId]);
  useEffect(() => { void reload(); }, [reload]);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setError(null); setInfo(null);
    try { await fn(); if (ok) setInfo(ok); await reload(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  if (!gate.allowed && !draft) return <Notice tone="blocked" title="Captura bloqueada">{gate.note}</Notice>;
  if (!draftId) return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Nueva captura</Text>
      <Text style={s.muted}>Elige la parcela. El borrador se guarda en el dispositivo desde el primer paso.</Text>
      {plots.map((p) => <Button key={p.id} kind="secondary" label={`${p.plot_code}${p.producer_code ? ` · ${p.producer_code}` : ''}${p.producer_display_name ? ` · ${p.producer_display_name}` : ''}`} onPress={() => void act(async () => onDraft(await store.createDraft(p.id)))} />)}
      {error && <Notice tone="blocked">{error}</Notice>}
    </>
  );
  if (!draft) return <Text style={s.muted}>Cargando borrador…</Text>;
  const editable = draft.status === 'DRAFT' && gate.allowed;
  const testEnv = synthetic;
  // Entorno de prueba sin cifrado: solo fixtures (ni cámara ni ubicación reales).
  const fixtureLoc = () => act(() => store.setLocation(draft.id, fixtureLocation(new Date())), 'Ubicación de prueba (sintética) guardada.');
  const fixturePhoto = () => act(async () => {
    const id = Crypto.randomUUID();
    await store.addPhoto(draft.id, writeCacheFile(fixtureJpeg(id), `fixture-${id}.jpg`), 'image/jpeg', new Date().toISOString());
  }, 'Foto de prueba (sintética) guardada.');
  /** Pide la ubicación (primer plano, a petición de la persona) y la MUESTRA. No toca el borrador. Una sola solicitud a la vez. */
  const locate = async () => {
    if (peeking) return;
    setPeeking(true); setError(null); setInfo(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Permiso de ubicación denegado. Puedes concederlo en los ajustes del sistema; el borrador, la nota y las fotos se conservan y puedes encolar sin ubicación.');
      if (!(await Location.hasServicesEnabledAsync())) throw new Error('Los servicios de ubicación del dispositivo están desactivados. Actívalos y vuelve a intentarlo; el borrador se conserva.');
      const status = await Location.getProviderStatusAsync().catch(() => null);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch((e: Error) => { throw new Error(locationErrorMessage(e.message)); });
      setPeek(readingFrom(
        { coords: { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy }, timestamp: loc.timestamp, mocked: typeof loc.mocked === 'boolean' ? loc.mocked : undefined },
        `expo-location getCurrentPositionAsync(Accuracy.High); proveedor elegido por el sistema (no garantiza GPS); gpsAvailable=${status?.gpsAvailable ?? 'desconocido'}; networkAvailable=${status?.networkAvailable ?? 'desconocido'}`,
      ));
      setNow(Date.now());
    } catch (e) { setError(msg(e)); } finally { setPeeking(false); }
  };
  /** Acción EXPLÍCITA: guarda la lectura mostrada como la ubicación del borrador (reemplaza la anterior, y la etiqueta del botón lo dice). */
  const useReading = () => act(async () => {
    if (!peek) return;
    if (!isFresh(peek)) throw new Error(`La lectura tiene más de ${FRESH_MAX_AGE_S} s: pulsa «Mi ubicación» otra vez antes de usarla. El borrador se conserva.`);
    await store.setLocation(draft.id, { latitude: peek.latitude, longitude: peek.longitude, accuracy_m: peek.accuracy_m, acquired_at: peek.acquired_at, provider_detail: peek.provider_detail, mocked: peek.mocked });
    setPeek(null);
  }, 'Ubicación guardada en el borrador.');
  /** Acción EXPLÍCITA: añade la lectura mostrada como vértice del polígono (al final). No cierra ni confirma el polígono. */
  const addVertexFromReading = () => act(async () => {
    if (!peek) return;
    if (!isFresh(peek)) throw new Error(`La lectura tiene más de ${FRESH_MAX_AGE_S} s: pulsa «Mi ubicación» otra vez antes de usarla. El borrador se conserva.`);
    await store.addVertex(draft.id, { latitude: peek.latitude, longitude: peek.longitude, accuracy_m: peek.accuracy_m, acquired_at: peek.acquired_at, provider_detail: peek.provider_detail, mocked: peek.mocked });
    setPeek(null);
  }, 'Vértice añadido al borrador.');
  const fixtureVertex = () => act(async () => {
    const n = draft.vertices.length;
    const f = fixtureLocation(new Date());
    await store.addVertex(draft.id, { ...f, latitude: f.latitude + (n % 2 === 0 ? 0.0004 * n : 0.0004 * (n - 1)), longitude: f.longitude + (n < 2 ? 0 : 0.0004 * (n - 1)) });
  }, 'Vértice de prueba (sintético) añadido.');
  const takePhoto = () => act(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Permiso de cámara denegado. Puedes concederlo en los ajustes; el borrador se conserva.');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.8, exif: false });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await store.addPhoto(draft.id, a.uri, a.mimeType ?? 'image/jpeg', new Date().toISOString());
  }, 'Foto copiada al almacenamiento persistente del dispositivo.');
  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Captura · {draft.plot_code ?? 'parcela'}</Text>
      {testEnv && <Notice tone="review" title={SYNTH_TITLE}>Solo fixtures sintéticos: esta compilación no usa la cámara ni la ubicación reales. El ensayo real se hace con el build nativo cifrado.</Notice>}
      <Badge tone={draft.status === 'DRAFT' ? 'neutral' : 'process'}>{draft.status === 'DRAFT' ? 'Borrador local' : 'En cola (pendiente de sincronización)'}</Badge>
      {!gate.allowed && <Notice tone="blocked">{gate.note}</Notice>}
      <Card title="Ubicación">
        {draft.location ? (
          <>
            <Text style={s.p}>Lat {draft.location.latitude.toFixed(6)} · Lon {draft.location.longitude.toFixed(6)}</Text>
            <Text style={s.p}>Precisión: {draft.location.accuracy_m === null ? 'no informada por el dispositivo' : `${Math.round(draft.location.accuracy_m)} m (informada)`}</Text>
            <Text style={s.muted}>Adquirida: {fmt(draft.location.acquired_at)} · registrada: {fmt(draft.location.recorded_at)}</Text>
            <Text style={s.muted}>Procedencia: servicio de ubicación del dispositivo (no se afirma GPS){draft.location.mocked ? ' · el sistema la marcó como simulada' : ''}</Text>
          </>
        ) : <Text style={s.muted}>Sin ubicación.</Text>}
        {editable && (testEnv
          ? <Button kind="secondary" label="Usar ubicación de prueba (sintética)" hint="Este entorno no captura ubicación real" onPress={() => void fixtureLoc()} disabled={busy} />
          : <Button kind="secondary" label="Mi ubicación" hint="Obtiene tu posición y la muestra; no guarda nada en el borrador" onPress={() => void locate()} disabled={busy || peeking} />)}
        {editable && !testEnv && peeking && <Text style={s.muted} accessibilityLiveRegion="polite">Obteniendo ubicación…</Text>}
        {editable && !testEnv && peek && (
          <View>
            <Text accessibilityRole="header" style={s.p}>Lectura de «Mi ubicación» (todavía no guardada)</Text>
            <Text style={s.p}>Lat {peek.latitude.toFixed(6)} · Lon {peek.longitude.toFixed(6)}</Text>
            <Text style={s.p}>Precisión: {peek.accuracy_m === null ? 'no informada por el dispositivo' : `${Math.round(peek.accuracy_m)} m (informada)`}</Text>
            <Text style={s.muted}>Adquirida: {fmt(peek.acquired_at)} · hace {ageSeconds(peek, now)} s</Text>
            <Text style={s.muted}>Procedencia: servicio de ubicación del dispositivo (no se afirma GPS){peek.mocked ? ' · el sistema la marcó como simulada' : ''}</Text>
            {qualityNotice(qualityOf(peek.accuracy_m)) && <Notice tone="review">{qualityNotice(qualityOf(peek.accuracy_m))!}</Notice>}
            {!isFresh(peek, now) && <Notice tone="review">La lectura tiene más de {FRESH_MAX_AGE_S} s. Pulsa «Mi ubicación» otra vez antes de usarla.</Notice>}
            <Text style={s.muted}>Esta app no muestra mapa: la ubicación se ofrece como coordenadas y precisión. La precisión es la de esta lectura.</Text>
            <Button label={draft.location ? 'Reemplazar la ubicación del borrador con esta lectura' : 'Usar esta ubicación en el borrador'} onPress={() => void useReading()} disabled={busy || !isFresh(peek, now)} />
            <Button kind="secondary" label="Descartar la lectura" onPress={() => setPeek(null)} disabled={busy} />
          </View>
        )}
      </Card>
      <Card title="Polígono de la parcela (vértices)">
        {draft.vertices.length === 0 ? <Text style={s.muted}>Sin vértices. Camina el borde de la parcela y añade un vértice en cada esquina.</Text> : draft.vertices.map((v) => (
          <Text key={v.id} style={s.p}>{v.seq}. Lat {v.latitude.toFixed(6)} · Lon {v.longitude.toFixed(6)} · {v.accuracy_m === null ? 'precisión no informada' : `±${Math.round(v.accuracy_m)} m`}</Text>
        ))}
        <Text style={s.muted}>Los vértices entran al borrador de polígono de la parcela. No crean geometría nueva ni validan nada: una persona revisa y confirma el polígono en la web. Esta app no muestra mapa; si faltan vértices o hay un cruce, se verá en la revisión web.</Text>
        {editable && !testEnv && <Button kind="secondary" label="Añadir vértice con la lectura de «Mi ubicación»" hint={peek ? undefined : 'Primero pulsa «Mi ubicación»'} onPress={() => void addVertexFromReading()} disabled={busy || !peek || !isFresh(peek, now)} />}
        {editable && testEnv && <Button kind="secondary" label="Añadir vértice de prueba (sintético)" onPress={() => void fixtureVertex()} disabled={busy} />}
        {editable && draft.vertices.length > 0 && <Button kind="secondary" label="Quitar el último vértice" onPress={() => void act(() => store.undoVertex(draft.id))} disabled={busy} />}
      </Card>
      <Card title="Fotos">
        {draft.photos.length === 0 ? <Text style={s.muted}>Sin fotos.</Text> : draft.photos.map((p) => (
          <Text key={p.id} style={s.p}>{p.file_present ? '✓' : '⚠'} {Math.round(p.size_bytes / 1024)} KB · SHA-256 {p.sha256.slice(0, 10)}… · recibida {fmt(p.captured_at)}{p.file_present ? '' : ' · ARCHIVO FALTANTE'}</Text>
        ))}
        {draft.photos.length > 0 && <Text style={s.muted}>Archivo procesado por la app: sin metadatos embebidos (se conserva solo la orientación). El SHA-256 corresponde a este archivo, no al original de la cámara.</Text>}
        {editable && (testEnv
          ? <Button kind="secondary" label="Usar foto de prueba (sintética)" hint="Este entorno no usa la cámara real" onPress={() => void fixturePhoto()} disabled={busy} />
          : <Button kind="secondary" label="Tomar foto" onPress={() => void takePhoto()} disabled={busy} />)}
      </Card>
      <Card title="Nota">
        {editable ? <Field label="Observación de campo" value={note} onChangeText={setNote} onEndEditing={() => void act(() => store.setNote(draft.id, note))} multiline maxLength={1000} /> : <Text style={s.p}>{draft.note || '—'}</Text>}
      </Card>
      {error && <Notice tone="blocked" title="No se completó">{error}</Notice>}
      {info && <Notice tone="valid">{info}</Notice>}
      {editable && <Button label="Guardar en cola" disabled={busy} onPress={() => void act(async () => { await store.setNote(draft.id, note); await store.enqueue(draft.id); onQueued(); })}
        hint="Guarda la captura y sus operaciones juntas en el dispositivo; no la envía" />}
      <Text style={s.muted}>«Guardar en cola» guarda la captura en el dispositivo; se envía con «Sincronizar ahora» cuando haya conexión.</Text>
    </>
  );
}

const OP_STATE: Record<string, [string, 'neutral' | 'process' | 'valid' | 'review' | 'blocked']> = {
  PENDING: ['Pendiente', 'process'], UPLOADING: ['Enviando', 'process'], SYNCED: [`Sincronizado (confirmado por el ${SERVER})`, 'valid'], FAILED: ['Rechazado', 'blocked'], CONFLICT: ['Conflicto', 'review'],
};
const PHOTO_STATE = (p: { upload_state: string; server_status: string | null }) => p.upload_state === 'LOCAL' ? 'archivo pendiente de subir' : p.server_status === 'AVAILABLE' ? `archivo disponible en el ${SERVER}` : p.server_status === 'PENDING_SCAN' ? 'archivo recibido, análisis pendiente' : `archivo ${p.server_status ?? p.upload_state}`;

function Pending({ store, onOpen }: { store: LocalStore; onOpen: (d: string) => void }) {
  const [drafts, setDrafts] = useState<DraftView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => store.drafts().then(setDrafts), [store]);
  useEffect(() => { void reload(); }, [reload]);
  const resolve = async (opId: string, version: number) => { setError(null); try { await store.resolveConflict(opId, version); await reload(); } catch (e) { setError(msg(e)); } };
  if (!drafts) return <Text style={s.muted}>Cargando…</Text>;
  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Pendientes</Text>
      <Notice tone="process">Una operación solo sale de la cola cuando el {SERVER} confirma su resultado. Registro y fotos tienen estados separados.</Notice>
      {error && <Notice tone="blocked">{error}</Notice>}
      {drafts.length === 0 && <Text style={s.muted}>No hay capturas en este dispositivo para esta cuenta y organización.</Text>}
      {drafts.map((d) => (
        <Card key={d.id} title={`${d.plot_code ?? 'Parcela'} · ${fmt(d.created_at)}`}>
          <Badge tone={d.status === 'DRAFT' ? 'neutral' : 'process'}>{d.status === 'DRAFT' ? 'Borrador local' : 'Pendiente (en cola)'}</Badge>
          <Text style={s.muted}>Ubicación: {d.location ? (d.location.accuracy_m === null ? 'sí (precisión no informada)' : `sí (±${Math.round(d.location.accuracy_m)} m)`) : 'no'}{d.plot_code ? '' : ' · la parcela ya no está en tus datos descargados'}</Text>
          {d.photos.map((p) => <Text key={p.id} style={s.muted}>Foto {p.sha256.slice(0, 8)}…: {PHOTO_STATE(p)}{p.server_detail ? ` (${p.server_detail})` : ''}</Text>)}
          {d.operations.map((o) => {
            const [label, tone] = OP_STATE[o.state] ?? [o.state, 'neutral'];
            const blocked = o.state === 'PENDING' && o.last_error?.startsWith('BLOQUEADO_POR_ACCESO');
            const serverVersion = (o.server_result?.error as { details?: { server_row_version?: number } } | null)?.details?.server_row_version;
            return (
              <View key={o.operation_id} style={{ marginTop: 6 }}>
                <Badge tone={blocked ? 'blocked' : tone}>{blocked ? 'Bloqueado por acceso' : label}</Badge>
                <Text style={s.muted}>{o.operation_type === 'PLOT_LOCATION_SAMPLE_CREATE' ? 'Muestra de ubicación' : 'Foto'} · {o.operation_id.slice(0, 8)}{o.recovered_count ? ` · recuperada ${o.recovered_count} vez/veces` : ''}{o.resolved_by ? ' · resuelta con otra operación' : ''}</Text>
                {o.last_error && <Text style={s.muted}>{o.last_error}</Text>}
                {o.state === 'CONFLICT' && !o.resolved_by && typeof serverVersion === 'number' && (
                  <Button kind="secondary" label={`Reenviar sobre la versión actual del ${SERVER} (${serverVersion})`} hint="Crea una operación nueva; la original se conserva" onPress={() => void resolve(o.operation_id, serverVersion)} />
                )}
              </View>
            );
          })}
          {d.status === 'DRAFT' && <Button kind="secondary" label="Continuar borrador" onPress={() => onOpen(d.id)} />}
        </Card>
      ))}
    </>
  );
}

function SelfTest() {
  const [r, setR] = useState<{ environment: string; ok: boolean; cases: SelfTestCase[] } | null>(null);
  useEffect(() => { void runSelfTest().then(setR); }, []);
  if (!r) return <Text style={s.muted}>Ejecutando autoprueba…</Text>;
  return (
    <Card title={`Autoprueba: ${r.ok ? 'todo correcto' : 'hay fallos'}`}>
      <Text style={s.muted}>Entorno: {r.environment === 'WEB_PREVIEW_SYNTHETIC' ? 'vista previa web (no aplica)' : r.environment === 'EXPO_GO_SYNTHETIC' ? 'Expo Go (sin cifrado: se esperan fallos de cifrado)' : 'build nativo'}. Base temporal propia; no toca datos de cuentas.</Text>
      {r.cases.map((c) => <View key={c.id} style={{ marginTop: 6 }}><Badge tone={c.ok ? 'valid' : 'blocked'}>{c.ok ? 'Correcto' : 'Falla'}</Badge><Text style={s.p}>{c.id}</Text><Text style={s.muted}>{c.detail}</Text></View>)}
    </Card>
  );
}

function Diagnostics({ session, orgId, store, recovery }: { session: StoredSession; orgId: string; store: LocalStore; recovery: RecoveryReport | null }) {
  const [device, setDevice] = useState('');
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => { void sessions.deviceId().then(setDevice); void expoPlatform.files.freeBytes().then(setFree); }, []);
  const enc = encryptionStatus();
  const gate = sessions.gate(session, orgId);
  return (
    <>
      <Text accessibilityRole="header" style={s.h1}>Diagnóstico</Text>
      <Card title="Protección local">
        <Badge tone={enc === 'SQLCIPHER_ACTIVE' ? 'valid' : 'blocked'}>{enc === 'SQLCIPHER_ACTIVE' ? 'Base local cifrada (SQLCipher)' : (isWebPreview ? 'Base local SIN cifrar: vista previa web (memoria del navegador), solo datos sintéticos' : 'Base local SIN cifrar: entorno de prueba (Expo Go), solo datos sintéticos')}</Badge>
        <Text style={s.muted}>Entorno: {isWebPreview ? 'vista previa web (diseño y navegación; no es el almacenamiento del dispositivo)' : runtimeEnvironment === 'EXPO_GO_SYNTHETIC' ? 'Expo Go (prueba)' : 'build nativo (exige cifrado; sin cifrado no abre el almacén)'}. Las fotos se guardan dentro de la base, así que comparten su protección. Durante una subida existe una copia temporal en la caché.</Text>
        <Text style={s.muted}>Token y clave de base: almacenamiento seguro del sistema. Almacén: {store.key.slice(0, 8)}… (cuenta + organización).</Text>
      </Card>
      <Card title="Sesión">
        <Text style={s.p}>Última autenticación con conexión: {fmt(session.last_online_auth_at)}</Text>
        <Text style={s.p}>Sesión emitida por el servidor vence: {fmt(session.token_expires_at)} (no se renueva ni se prolonga sin red)</Text>
        <Text style={s.p}>Captura: {gate.allowed ? 'permitida' : `bloqueada (${gate.note})`}</Text>
        <Text style={s.muted}>No hay autorización local más larga que la sesión (D-40 es una propuesta no aprobada). Sin conexión no se detectan revocaciones; al sincronizar el servidor revalida sesión, dispositivo, membresía y permisos.</Text>
      </Card>
      {isWebPreview && <PreviewControls />}
      <SelfTestLauncher />
      <Card title="Dispositivo y almacenamiento">
        <Text style={s.p}>Identificador local del dispositivo: {device.slice(0, 8)}… (no autoriza nada)</Text>
        <Text style={s.p}>Espacio libre: {free === null ? 'desconocido' : `${Math.round(free / 1048576)} MB`}</Text>
        <Text style={s.muted}>Última recuperación: {recovery ? `${recovery.recovered_operations.length} operación(es) recuperada(s), ${recovery.incomplete_temp_files.length} temporal(es) incompleto(s), ${recovery.orphan_files.length} archivo(s) sin registro (se conservan), ${recovery.missing_files.length} faltante(s)` : '—'}</Text>
      </Card>
    </>
  );
}

function SelfTestLauncher() {
  const [show, setShow] = useState(false);
  return show ? <SelfTest /> : <Button kind="secondary" label="Ejecutar autoprueba de seguridad (cifrado y temporales)" onPress={() => setShow(true)} />;
}

/** Solo vista previa web: escenarios del servidor SIMULADO para revisar estados de la interfaz. */
function PreviewControls() {
  const [st, setSt] = useState(previewState());
  const pick = (x: PreviewScenario) => { setPreviewScenario(x); setSt(previewState()); };
  const SC: Array<[PreviewScenario, string]> = [['NORMAL', 'Normal'], ['OFFLINE', 'Sin conexión'], ['CONFLICT_NEXT', 'Próxima muestra en conflicto'], ['DEVICE_REVOKED', 'Dispositivo revocado']];
  return (
    <Card title="Escenarios de la vista previa (simulados)">
      <Text style={s.muted}>Cambian solo el servidor SIMULADO de este navegador. Escenario actual: {SC.find(([k]) => k === st.scenario)?.[1]}.</Text>
      {SC.map(([k, l]) => <Button key={k} kind="secondary" label={`${st.scenario === k ? '● ' : ''}${l}`} onPress={() => pick(k)} />)}
      <Button kind="secondary" label={st.storageFull ? 'Restablecer espacio libre' : 'Simular almacenamiento lleno'} onPress={() => { setPreviewStorageFull(!st.storageFull); setSt(previewState()); }} />
      <Button kind="secondary" label="Simular sesión vencida (recarga la vista)" onPress={() => void expirePreviewSession().then(reloadPage)} />
      <Button kind="secondary" label="Borrar datos de la vista previa (recarga la vista)" onPress={() => { resetPreview(); reloadPage(); }} />
    </Card>
  );
}
