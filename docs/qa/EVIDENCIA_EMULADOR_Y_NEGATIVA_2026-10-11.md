# Evidencia — recorrido en emulador, prueba negativa sin SQLCipher, orientación y preparación del ensayo físico (2026-10-11)

Separación de evidencias: **Node** (pruebas unitarias/cliente), **emulador** (Android 11 API 30 x86_64, sin teléfono físico)
y **teléfono físico** (pendiente). Ninguna sustituye a otra.

## 1. Recorrido integrado en EMULADOR — INTERRUMPIDO

Herramientas: `e2e/movil/adb-ui.mjs` (adb + uiautomator), `e2e/movil/proxy.mjs` (sin red / corte tras commit),
`e2e/movil/recorrido-emulador.mjs` (pasos y evidencia). Resultado: `docs/qa/movil-emulador/recorrido.json`.

| Paso | Resultado |
| --- | --- |
| Preparación (permisos por adb, posición EMULADA, proxy) | OK (`docs/qa/capturas/movil-emulador/01-inicio.png`) |
| Inicio de sesión online desde la interfaz (tecnico1 DEMO, organización DEMO · Cooperativa) | OK hasta abrir el almacén |
| Apertura del almacén cifrado | **FALLA**: «file is not a database» (`05-fallo-login.png`) |
| Descarga, captura, foto, offline, cierre forzado, sincronización, interrupción tras commit, foto en Documentos, conflicto, cambio de cuenta, vencimiento, revocación, almacenamiento lleno inducido | **NO EJECUTADOS** |

**Defecto real hallado** (no lo detectaban las pruebas en Node): `withExclusiveTransactionAsync` de expo-sqlite abre
una conexión nueva que no recibe `PRAGMA key`; con SQLCipher la primera transacción falla. Corrección en
`apps/mobile/src/adapters/expo.ts`: una sola conexión con clave, operaciones serializadas en cola y `BEGIN IMMEDIATE /
COMMIT / ROLLBACK` explícitos. La autoprueba incorpora `almacen_cifrado_transaccional` para detectar esta regresión.
**La recompilación con la corrección no terminó**: la guardia de disco detuvo Gradle con 2,07 GB libres.

Incidente de evidencia: en un primer intento la automatización escribió una credencial DEMO en el campo «Servidor»
(tocó la etiqueta y no el campo). La captura de fallo con la credencial visible **se eliminó** (no se versionó). El
controlador se corrigió (escribe en el campo bajo la etiqueta, cierra el teclado antes de tocar) y ninguna captura se
guarda si la pantalla contiene una contraseña conocida.

## 2. Prueba negativa sin SQLCipher — NO COMPILADA

Preparada: `TL_VARIANT=negativa` en `apps/mobile/app.config.js` → identificador `ec.agtech.terralink.campo.pruebanegativa`
(almacenamiento separado), `useSQLCipher: false` en la configuración nativa, nombre «TL PRUEBA NEGATIVA (sin SQLCipher)»
y rótulo en pantalla. La app, en build nativo, sondea el cifrado al iniciar: si no hay SQLCipher se bloquea **antes del
inicio de sesión** (sin token, dataset ni fotos) y registra `TL_NEGATIVE` con el inventario de archivos y la presencia
(no el valor) de secretos. Comandos previstos: `TL_VARIANT=negativa npx expo prebuild --platform android --no-install --clean`
y `gradlew assembleRelease`; APK a `apps/mobile/dist-apk/terra-link-campo-PRUEBA-NEGATIVA-sin-sqlcipher.apk`.
**No se compiló**: espacio libre insuficiente (2,73 GB < guardia de 4 GB).

## 3. Disco

Antes del trabajo: 8,19 GB libres. Tras compilar el APK de aceptación y arrancar el emulador, el libre cayó hasta
2,07 GB; borrando solo salidas propias (intermedios de compilación y datos del emulador) volvió a 2,6–2,7 GB. El
consumo restante no corresponde a carpetas medidas (Gradle 2,44 GB, SDK 9,14 GB, node_modules móvil 1,28 GB, Temp
0,80 GB, disco virtual de Docker sin cambios 40,24 GB); lo más probable es el crecimiento del archivo de paginación de
Windows por la memoria del emulador, Gradle y Docker, que se recupera al reiniciar (no se pudo medir sin
administrador). No se amplió la limpieza.

## 4. Orientación (fixtures con píxeles reales) — DEMOSTRADO

`e2e/review/orientacion-visual.mjs`: imágenes sintéticas con píxeles rotados y EXIF de orientación 1/3/6/8 (más modelo,
fecha y GPS ficticios), procesadas con la regla del servidor y renderizadas en Chromium. La procesada se ve igual que
la original (diferencia de píxeles 0) y que la referencia vertical (solo ruido JPEG); sin modelo, fecha ni GPS; el
servidor acepta la procesada y rechaza la original (`sync.int-spec.ts`, 7/7). Resultado: `docs/qa/orientacion/resultado.json`,
captura `docs/qa/capturas/orientacion-fixtures.png`. El SHA-256 de la procesada es del archivo procesado por la app.

## 5. Preparación del ensayo físico

- APK existente: `apps/mobile/dist-apk/NO-APTO-defecto-sqlcipher-transaccion-43f26c95.apk` (renombrado; NO instalar), SHA-256
  `43f26c95df008f232225f7bc350490034026ad114fc6a1279430fedf681d3219`, versión 0.1.0. **No apto**: contiene el defecto
  de transacción con SQLCipher descrito arriba. Hay que recompilar con la corrección (requiere espacio; tras reiniciar
  Windows y medir de nuevo).
- Instalación (cuando exista el APK corregido): `adb devices` → `adb install -r <apk>` → `adb reverse tcp:4000 tcp:4000` →
  servidor `http://localhost:4000`.
- Resultados que debe registrar el usuario: modelo y versión de Android; SHA-256 del APK instalado; autoprueba (todos
  los casos «Correcto»); login y descarga; captura con ubicación real y con permiso denegado; foto real sin EXIF en la
  web; cierre forzado y reapertura (mismos identificadores); reinicio del teléfono; sincronización y foto «disponible»
  solo tras el análisis; conflicto resuelto desde la app; cambio de cuenta; sesión vencida (1 h).
- Almacenamiento lleno: **no** llenar el teléfono personal; se prueba en emulador con un archivo de relleno (fallo
  inducido, distinto de una falta real de espacio).

> Actualización: APK apto para el ensayo físico `APTO-ensayo-fisico-9996a9b4.apk` y resultado de la prueba negativa en
> `docs/qa/EVIDENCIA_APK_9996a9b4_Y_NEGATIVA_2026-10-11.md`. Los APK `43f26c95` y `184cbfa8` son NO APTOS.
