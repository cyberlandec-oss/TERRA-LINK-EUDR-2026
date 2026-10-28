# Terra Link Campo (móvil, P0-023/P0-024)

Captura de campo con almacenamiento local y sincronización: React Native + Expo SDK 57 (expo-sqlite, expo-file-system,
expo-secure-store, expo-location, expo-image-picker, expo-crypto, expo-constants). Proyecto **independiente** de los
workspaces npm de la raíz: no cambia `npm run validate`.

- **Operaciones que sincroniza**: muestra de ubicación de una parcela (`PLOT_LOCATION_SAMPLE_CREATE`) y foto de parcela
  (`PLOT_PHOTO_ATTACH`, la nota viaja como leyenda). **No** cubre productores, entregas, recepciones, lotes ni inventario.
- **Sesión**: inicio solo con conexión; la captura termina cuando vence la sesión emitida por el servidor (1 h). No se
  renueva ni se prolonga sin red; al vencer, lo guardado se conserva y sigue visible.
- **Entornos**: Expo Go = prueba **sin cifrado** limitada a **fixtures sintéticos** (la app no usa la cámara ni la
  ubicación reales en Expo Go). Pertenecer a una organización DEMO no vuelve sintética una foto o ubicación real.
  Build nativo = exige SQLCipher: si no se inicializa, el almacén no se abre (no descarga ni guarda datos). El ensayo con
  fotos y ubicación reales se hace **solo** con el build nativo.
- **Fotos (D-41)**: dato personal; se quitan EXIF/XMP/IPTC antes de guardar; el servidor rechaza fotos con metadatos.

## Comprobaciones reproducibles (sin dispositivo)

```bash
npm run check --prefix apps/mobile            # typecheck, núcleo (Node + SQLite real), bundle Android, expo-doctor
npm run check --prefix apps/mobile -- --api   # + recorrido contra la API local levantada con DEMO sembrado
```

Resultados en `validation-results/<fecha>-movil/`. Es evidencia **en Node**: no es emulador, build nativo ni dispositivo.

## A. Prueba limitada con Expo Go (sin cifrado, solo fixtures)

1. App web/API levantada (`docker compose --profile app up -d --wait`); IP local del equipo (`ipconfig`) y puerto TCP
   4000 permitido en el firewall de Windows para redes privadas.
2. `cd apps/mobile && npm ci && npx expo start --lan`; escanea el QR con Expo Go (SDK 57).
3. Servidor `http://<IP>:4000`; usuario `tecnico1.cooperativa@demo.terralink.local` (contraseña en tu `CREDENCIALES.csv`
   local más reciente; no la copies en informes). Organización «DEMO · Cooperativa Río Verde».
4. «Descargar datos asignados» → «Nueva captura» → «Usar ubicación de prueba (sintética)» y «Usar foto de prueba
   (sintética)» → «Guardar en cola». (En Expo Go no hay botones de cámara ni ubicación real.)
5. Modo avión → forzar cierre → reiniciar el teléfono → abrir: borrador, cola y fotos de prueba siguen.
6. Con red: «Sincronizar ahora» → Pendientes: «Sincronizado» y estado de la foto («análisis pendiente» / «disponible»).
7. Cambio de cuenta (`tecnico2…`): no ve nada de tecnico1. Revocación del dispositivo: la sincronización se detiene.

## B. Build nativo de aceptación (cifrado) — generado en este equipo; autoprueba aprobada en emulador; teléfono físico pendiente

Requiere Android SDK + JDK 17 + `adb` (o una cuenta de EAS). `app.json` ya activa `useSQLCipher` en el plugin de
expo-sqlite.

- Local: `cd apps/mobile && npx expo prebuild --platform android && npx expo run:android --variant debug` con el teléfono
  conectado por USB (depuración activada). El build permite HTTP sin TLS solo hacia localhost/127.0.0.1
  (plugin `plugins/with-local-cleartext.js`), para la API local mediante `adb reverse`; el resto exige TLS.
- EAS: `npx eas build --platform android --profile development` (requiere `eas.json` y cuenta; no incluido).
- Verificación: «Diagnóstico» debe mostrar «Base local cifrada (SQLCipher)». Prueba de rechazo: un build nativo sin
  SQLCipher debe mostrar «Almacenamiento protegido no disponible» y no descargar datos.
- **APK NO APTOS (no instalar)** en `apps/mobile/dist-apk/`:
  - `NO-APTO-defecto-sqlcipher-transaccion-43f26c95.apk`: defecto de transacción con SQLCipher («file is not a database»).
  - `NO-APTO-mensaje-almacenamiento-lleno-184cbfa8.apk` (antes `CANDIDATO-aceptacion-184cbfa8.apk`): autoprueba 9/9 y recorrido en emulador casi completo (intento 5), pero con
    almacenamiento lleno muestra el error técnico de SQLite al crear un borrador (corregido en código, pendiente de
    recompilar y verificar). Queda retirado del recorrido de instalación.
- **APK APTO para el ensayo físico**: `apps/mobile/dist-apk/APTO-ensayo-fisico-9996a9b4.apk`, SHA-256
  `9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2`, commit `0ba960a`. Autoprueba 9/9 y recorrido
  completo en emulador (`docs/qa/EVIDENCIA_APK_9996a9b4_Y_NEGATIVA_2026-10-11.md`). Instalar: `adb install -r` + `adb reverse tcp:4000 tcp:4000`.
  El ensayo físico está pendiente.
- Ruta de compilación: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk` (regenerable con `npx expo prebuild --platform android --no-install` y `cd android && gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64`). Solo instalar en un teléfono el APK registrado como APTO en `docs/qa` (SHA-256 completo).
- Autoprueba en el teléfono: «Diagnóstico» → «Ejecutar autoprueba de seguridad», o `adb shell am start -a android.intent.action.VIEW -d "terralinkcampo://autoprueba" ec.agtech.terralink.campo`; todos los casos deben salir «Correcto».
- Teléfono físico: activar «Opciones de desarrollador» → «Depuración USB», conectar por USB, aceptar la huella del
  equipo, comprobar con `adb devices`. Para la API local: `adb reverse tcp:4000 tcp:4000` y servidor `http://localhost:4000`.
- Ensayo real (solo aquí): capturar ubicación real (y denegando el permiso), fotos reales (comprobar en la web que el
  documento no conserva EXIF), cierre forzado, reinicio, esperar el vencimiento de la sesión (1 h), cambio de cuenta,
  almacenamiento casi lleno (llenar con un archivo grande y reintentar una foto), sincronizar, provocar un conflicto
  (editar la geometría de la parcela en la web antes de sincronizar) y resolverlo con «Reenviar sobre la versión actual».
- Registrar modelo, versión de Android, build, fecha, resultados y capturas sin datos
  personales en `docs/qa/ENSAYO_ANDROID_P0-023.md` (créalo al ejecutar el ensayo; no existe hasta entonces).

### Qué requiere cada entorno (no mezclar)

| Comprobación | Expo Go | Build nativo (APK APTO) | Teléfono físico |
| --- | --- | --- | --- |
| Cola, reintento, conflicto, cambio de cuenta (fixtures sintéticos) | Sí | Sí | — |
| **SQLCipher activo** («Base local cifrada (SQLCipher)») y autoprueba 9/9 | **No** (Expo Go no lo incluye) | Sí (emulador hecho 2026-10-11) | **Pendiente** |
| Ubicación y fotos **reales**, EXIF eliminado | No | Sí | **Pendiente** |
| Almacenamiento casi lleno, cierre forzado, reinicio del teléfono | Parcial | Emulador hecho | **Pendiente** |

**Compatibilidad del APK (corregida el 2026-10-27):** el APK APTO `9996a9b4` se compiló con el código de `0ba960a` y el recorrido
del 2026-10-20 (`validation-results/2026-10-20T00-01-34-059Z-movil/`) pasó contra la API de entonces. **Desde entonces el código de
`apps/mobile` cambió** (entrega D, 2026-10-27): captura de vértices de polígono, alcance propio del Productor y aviso del límite de sesión.
Ese APK **no los contiene**. Para probarlos hace falta compilar un APK nuevo y repetir el recorrido en emulador y, al final, en el teléfono;
hasta entonces lo nuevo cuenta solo como probado con pruebas unitarias en Node y con la API real (integración), no como probado en Android.

### Ensayo en teléfono físico: pasos y evidencia esperada

1. `certutil -hashfile apps\mobile\dist-apk\APTO-ensayo-fisico-9996a9b4.apk SHA256` → `9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2`. *Evidencia:* hash en el informe.
2. `adb devices`, `adb install -r <apk>`, `adb reverse tcp:4000 tcp:4000`; servidor `http://localhost:4000`, API local con DEMO sembrado.
3. «Diagnóstico» → «Ejecutar autoprueba de seguridad». *Esperado:* 9/9 «Correcto» y «Base local cifrada (SQLCipher)». *Evidencia:* captura.
4. Ubicación real concedida y denegada; foto real. *Esperado:* denegar permite continuar sin ubicación; la web muestra el documento sin EXIF.
5. Guardar sin red → cierre forzado → reiniciar teléfono. *Esperado:* borrador y cola intactos, mismos identificadores.
6. Sincronizar con red. *Esperado:* una sola muestra y una foto en el servidor, sin duplicados; reintento tras corte no duplica.
7. Editar la geometría en la web antes de sincronizar → conflicto visible → «Reenviar sobre la versión actual». *Esperado:* original conservada, nueva aceptada.
8. Cambio de cuenta (`tecnico2…`): no ve lo de `tecnico1`. Dispositivo revocado: la sincronización se detiene.
9. Almacenamiento casi lleno: mensaje en español, sin error técnico, cola intacta. Sesión vencida (1 h): captura bloqueada, lo guardado visible.
10. Informe `docs/qa/ENSAYO_ANDROID_P0-023.md` con modelo, versión de Android, SHA del APK, fecha y resultado por paso. Sin datos personales.

Este ensayo es el gate «Android real»; no implica producción ni conformidad EUDR.

### Reparto de pasos del ensayo físico (quién hace qué)

**Estado de partida comprobado el 2026-10-20** (sobre la API desplegada `4f7e635`): `npm run check --prefix apps/mobile -- --api`
→ typecheck **OK**, núcleo **OK**, recorrido contra la API **OK**, bundle Android **OK**, `expo-doctor` **FALLA** (20/21: seis
paquetes de Expo SDK 57 con parches más nuevos disponibles; no es del contrato). **No se recompila el APK ni se actualizan
dependencias** para este ensayo: el APK `APTO-ensayo-fisico-9996a9b4` (SHA-256 `9996a9b4…6ab2`, commit `0ba960a`) corresponde a un
código móvil que no ha cambiado. Registro: `validation-results/2026-10-20T03-50-55-065Z-movil/`. Teléfono conectado a `adb` hoy: **ninguno**.

**Qué hace la persona con el teléfono**

| # | Paso | Resultado esperado | Evidencia que aporta |
| --- | --- | --- | --- |
| P1 | Activar «Opciones de desarrollador» y «Depuración USB»; conectar por cable y aceptar la huella del equipo | `adb devices` lista el teléfono como `device` (no `unauthorized`) | Modelo y versión de Android |
| P2 | Instalar el APK con el comando de abajo e iniciar la app | La app abre en español, sin avisos de almacenamiento | Captura de la pantalla de inicio |
| P3 | «Diagnóstico» → «Ejecutar autoprueba de seguridad» | **9/9 «Correcto»** y «Base local cifrada (SQLCipher)» | Captura |
| P4 | Iniciar sesión (servidor `http://localhost:4000`; cuenta `tecnico1.cooperativa`, contraseña de tu `CREDENCIALES.csv` local, no la copies en informes) y «Descargar datos asignados» | 5 parcelas asignadas | Captura de la lista |
| P5 | Captura con **ubicación real** (conceder el permiso) y otra **denegándolo**; una **foto real** | Con permiso se guarda; sin permiso se puede continuar sin ubicación | Capturas sin datos personales |
| P6 | Modo avión → guardar un borrador → forzar el cierre → **reiniciar el teléfono** → abrir | Borrador, cola y foto siguen, con los mismos identificadores | Captura de «Pendientes» |
| P7 | Con red: «Sincronizar ahora» | «Sincronizado»; foto «análisis pendiente» y luego «disponible» | Captura |
| P8 | Interrumpir la red a mitad de una sincronización y reintentar | Sin duplicados | Captura de «Pendientes» |
| P9 | Conflicto: tras avisarme, esperar a que yo edite la geometría de la parcela en la web; sincronizar y «Reenviar sobre la versión actual» | Conflicto visible; se conserva el original y se acepta la versión nueva | Captura del conflicto y de la resolución |
| P10 | Cambiar de cuenta (`tecnico2.cooperativa`) y volver | La otra cuenta no ve lo de la primera; aviso por pendientes | Captura |
| P11 | Almacenamiento casi lleno: llenar con un archivo grande y reintentar una foto | Mensaje en español «No hay espacio libre…», sin error técnico, cola intacta | Captura |
| P12 | Esperar el vencimiento de la sesión (1 h) | Captura bloqueada; lo guardado sigue visible | Captura |
| P13 | Informe con modelo, versión de Android, SHA del APK, fecha y resultado por paso | — | `docs/qa/ENSAYO_ANDROID_P0-023.md` (sin datos personales) |

Comandos de la persona (desde la raíz del repositorio, en el equipo con el teléfono conectado):

```
adb devices
certutil -hashfile apps\mobile\dist-apk\APTO-ensayo-fisico-9996a9b4.apk SHA256     # debe ser 9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2
adb install -r apps\mobile\dist-apk\APTO-ensayo-fisico-9996a9b4.apk
adb reverse tcp:4000 tcp:4000
adb reverse --list                                                                    # debe mostrar tcp:4000
adb shell am start -a android.intent.action.VIEW -d "terralinkcampo://autoprueba" ec.agtech.terralink.campo
```

**Conectividad**: el APK solo admite HTTP sin TLS hacia `localhost`; por eso se usa `adb reverse` y el servidor `http://localhost:4000`
(no la IP de la red). Comprobación rápida desde el teléfono: abrir en su navegador `http://localhost:4000/health/live` (con el
`reverse` activo debe responder). `adb` está en `%LOCALAPPDATA%\Android\Sdk\platform-tools`.

**Qué verifica el equipo (yo), antes, durante y después**

| Cuándo | Verificación desde el equipo |
| --- | --- |
| Antes | API desplegada (`/version`), DEMO sembrado con `tecnico1/2.cooperativa`, hash del APK, `adb devices` con el teléfono autorizado, espacio libre en disco |
| P9 | Yo edito la geometría de la parcela en la web para provocar el conflicto, cuando la persona lo indique |
| P7–P8 | En el servidor: **una sola** muestra de ubicación y **una sola** foto por operación (sin duplicados tras el corte), con los identificadores del teléfono |
| P5/P7 | El documento de la foto en la web **no conserva EXIF/XMP/IPTC** (D-41) |
| P10 | Que ninguna operación de `tecnico1` aparezca bajo `tecnico2` ni en otra organización |
| Después | Auditoría de las operaciones, dispositivo registrado y revocación probada (la sincronización se detiene), y contraste del informe con lo observado en el servidor |

Si el teléfono todavía no está disponible, el ensayo **queda pendiente**: P0-023 y P0-024 no se cierran con el emulador.

## Diseño

- `src/core`: puertos, esquema SQLite (fotos como BLOB dentro de la base), almacén por cuenta+organización, sesión,
  hash canónico de operaciones y motor de sincronización.
- `src/adapters/expo.ts`: SQLite (+SQLCipher), archivos, almacenamiento seguro, detección Expo Go/build nativo, subida.
- `src/app`: sesión online, dispositivo registrado en el servidor, transporte HTTP. `src/ui`: pantallas.
- Contratos: `docs/11_OFFLINE_Y_SINCRONIZACION.md`; decisión: `docs/adr/0006-movil-offline.md`.

## Vista previa web (diseño y navegación)

`npm run web:preview` (desde `apps/mobile`) levanta la interfaz en `http://localhost:3001` con adaptadores solo web
(`src/adapters/*.web.ts`): base en memoria del navegador sin cifrar, fixtures de foto y ubicación y servidor SIMULADO
(ninguna petición llega a la API). Cuentas sintéticas `@vista-previa.invalid`; escenarios en «Diagnóstico». No prueba
cifrado, cámara, ubicación ni Android. Informe: `docs/qa/REVISION_WEB_MOVIL_2026-10-11.md`.
