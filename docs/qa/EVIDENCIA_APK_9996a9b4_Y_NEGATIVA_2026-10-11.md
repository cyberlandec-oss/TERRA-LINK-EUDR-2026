# Evidencia — APK de aceptación 9996a9b4 (APTO para ensayo físico) y prueba negativa (2026-10-11)

Separación: **emulador** (esta evidencia) ≠ **teléfono físico** (pendiente) ≠ Node. APTO aquí significa «apto para
instalar en el ensayo físico», no producción, despliegue ni conformidad EUDR.

## 1. APK de aceptación — APTO para el ensayo físico

| Dato | Valor |
| --- | --- |
| Archivo | `apps/mobile/dist-apk/APTO-ensayo-fisico-9996a9b4.apk` (no versionado) |
| SHA-256 | `9996a9b419508fdbd3b225a08aae39333b705ef125a68b527507c0efd6f46ab2` |
| Commit | `0ba960a` (rama `feat/tech-001-ci-p0-002`) |
| Build | `npx expo prebuild --platform android --no-install --clean`; `.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64 --no-daemon`; `expo.sqlite.useSQLCipher=true` |
| Compilación | 5 m 25 s bajo guardia de disco (mín. libre 24,01 GB; `validation-results/android/guardia-aceptacion-3.json`) |

**Autoprueba en emulador** (`docs/qa/autoprueba-emulador-9996a9b4.json`): 9/9 — SQLCipher activo, archivo cifrado,
contenido no legible, clave incorrecta falla, clave correcta lee, **almacén cifrado transaccional** (regresión de la
segunda conexión sin clave), la app rechaza sin cifrado, temporal de subida limpio tras fallo, temporal huérfano eliminado.

**Recorrido completo, intento 6** (`docs/qa/movil-emulador/recorrido.json`, `validation-results/emulador/recorrido-intento-6.log`):
transacciones reales sobre el almacén cifrado en todos los pasos.

| Paso | Resultado |
| --- | --- |
| Preparación, inicio de sesión, descarga (5 parcelas), ubicación EMULADA, foto (cámara virtual) | OK |
| Guardado sin conexión; cierre forzado y reapertura con mismos identificadores | OK |
| Interrupción tras commit y reintento: 1 muestra, mismos identificadores, sin duplicar | OK |
| Foto «análisis pendiente» (no descargable) → disponible tras el análisis | OK |
| Conflicto por edición web y resolución desde la app (original conservada, nueva aceptada) | OK |
| Cambio de cuenta (aviso de pendientes; otra cuenta no ve; la misma recupera) | OK |
| Sesión vencida (+2 h UTC) y reloj atrasado (−1 día) | OK |
| Almacenamiento lleno inducido | OK en la 4.ª ejecución: mensaje en español «No hay espacio libre en el dispositivo…», sin error técnico; cola intacta (2 operaciones) |
| Dispositivo revocado | OK |

Las tres ejecuciones fallidas del paso de almacenamiento fueron de **automatización**: (1) tras «vencimiento» la
captura queda bloqueada por reloj hasta volver a iniciar sesión (comportamiento correcto de la app) y el botón
deshabilitado no se distinguía por texto; (2) la limpieza usaba `adb shell sh -c rm …` (adb concatena argumentos y el
`rm` quedaba sin operando), por lo que el relleno no se borraba; (3) la comprobación de reinicio de sesión no detectaba
el bloqueo. Corregido: inicio de sesión previo siempre, limpieza en `finally` con un solo comando. Relleno controlado
(5 654 MB): C: 23,76 GB antes y después.

Observación de UX (no bloqueante): el aviso de espacio aparece al final de la lista de parcelas, parcialmente bajo el pliegue.

### Instalación (ensayo físico)

```
adb devices
adb install -r "apps/mobile/dist-apk/APTO-ensayo-fisico-9996a9b4.apk"
adb reverse tcp:4000 tcp:4000
```

Comprobar en el teléfono el SHA-256 del archivo antes de instalar (`certutil -hashfile <apk> SHA256` en Windows) y
usar `http://localhost:4000` como servidor. Lista del ensayo: `docs/qa/EVIDENCIA_EMULADOR_Y_NEGATIVA_2026-10-11.md` §5.
**El ensayo físico sigue pendiente.**

## 2. Prueba negativa sin SQLCipher — resultado separado

| Dato | Valor |
| --- | --- |
| Archivo | `apps/mobile/dist-apk/PRUEBA-NEGATIVA-sin-sqlcipher.apk` (no versionado; no instalar en teléfonos) |
| SHA-256 | `33b124e0c74df1ea09d24a7626a3c0eb0731595fd38d70d37f11b0512066b90e` |
| Identificador | `ec.agtech.terralink.campo.pruebanegativa` (almacenamiento separado); `expo.sqlite.useSQLCipher=false` |
| Compilación | 9 m 41 s bajo guardia (mín. 24,2 GB), con el emulador apagado |

Resultado en emulador: la app se bloquea **antes del inicio de sesión** con «Almacenamiento protegido no disponible»
(`docs/qa/capturas/prueba-negativa/01-bloqueo-antes-de-login.png`). `TL_NEGATIVE` (`docs/qa/prueba-negativa/tl-negative.log`):
sonda inactiva, sin documentos ni bases, ningún secreto presente (token, sesión, dispositivo, URL). Inventario como root
(`docs/qa/prueba-negativa/inventario-root.txt`): solo dos archivos del framework (preferencias de Expo y profile
installer); ninguna base, token ni foto. La app se desinstaló después.

**Limitación de etiquetado**: `TL_VARIANT=negativa` se aplicó en el prebuild pero no durante la compilación Gradle, así
que la configuración embebida quedó con `variant: ACEPTACION` y la cabecera dice «Build nativo» en vez de «PRUEBA
NEGATIVA». El identificador aislado y la ausencia de SQLCipher sí son los de la variante negativa. Para el próximo build
negativo, exportar `TL_VARIANT=negativa` también durante `gradlew`.

## 3. Pendiente

- Ensayo en teléfono físico con este APK (no ejecutado).
- P0-023 y P0-024 siguen ABIERTAS.
