# Evidencia — limpieza autorizada, entorno Android y build nativo (2026-10-11)

## 1. Limpieza de cachés (autorizada: solo caché de compilación de Docker y caché de npm)

| Medición | Antes | Después |
| --- | --- | --- |
| Libre en C: | 6,31 GB (6 778 462 208 B) | 12,01 GB (12 900 392 960 B) |
| Caché de compilación de Docker | 11,25 GB (274 entradas, 0 activas) | 0 B |
| Caché de npm (`%LOCALAPPDATA%\npm-cache`) | 5,56 GB (`_cacache` 4,91; `_npx` 0,64; `_prebuilds` 0,02) | 0,02 GB |
| `docker_data.vhdx` (disco virtual Docker/WSL) | 40,24 GB | 40,24 GB |

Acciones: `npm cache clean --force`; vaciado de `_npx` (caché de npx); `docker builder prune -a -f`. No se usó
`docker system prune`; se conservaron volúmenes, imágenes, contenedores, bases, `node_modules`, lockfiles y evidencia.
Lo recuperado en C: (+5,70 GB) corresponde a la caché de npm: la caché de Docker se libera dentro del disco virtual, que
no se compactó (no autorizado). Más tarde el libre llegó a 17,75 GB sin acciones adicionales (devolución de espacio de
Docker/WSL, no provocada). Servicios tras limpiar: todos activos; web 200; API ready 200.
Registros: `validation-results/limpieza-2026-10-11/` (antes, acciones, después, salud del escáner).

## 2. Entorno Android (perfil de usuario, sin administrador)

- Microsoft OpenJDK 17.0.20.1 (zip; SHA-256 verificado con el publicado).
- Android command-line tools 15859902 (SHA-256 verificado), platform-tools 37.0.1, Platform 36 (r2), Build-Tools 36.0.0;
  NDK 27.0.12077973 y 27.1.12297006 y CMake 3.22.1 (descargados por Gradle); emulador 37.2.12; imagen
  `system-images;android-30;default;x86_64`. Aceleración WHPX disponible.
- Guardia de disco: detener si C: < 4 GB. Para mantener margen se borraron solo salidas propias regenerables
  (`android/app/build/intermediates` y datos del emulador de prueba).

## 3. Build nativo

`npx expo prebuild --platform android --no-install` (con `expo.sqlite.useSQLCipher=true`) y
`gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,x86_64` (variante release firmada con la clave de depuración;
JavaScript incluido, sin Metro). Gradle 9.3.1. Primera compilación 29 min 29 s; incremental 5 min 54 s. APK final 57 MB,
SHA-256 `e484cf4aa4f488367e7e6d199258cc3a9a45680cb93ed0bb6efc9755033238d1`; incluye `libexpo-sqlite.so` con SQLCipher y
`libcrypto.so` para ambas arquitecturas (evidencia estática).

## 4. Autoprueba en EMULADOR (Android 11, API 30, x86_64) — no es un teléfono físico

`adb shell am start -a android.intent.action.VIEW -d "terralinkcampo://autoprueba" ec.agtech.terralink.campo`; resultado en
`docs/qa/autoprueba-emulador-api30.json` y captura `docs/qa/capturas/movil-autoprueba-emulador-api30.png`.

| Caso | Resultado |
| --- | --- |
| sqlcipher_activo | OK — cipher_version 4.7.0 community |
| archivo_cifrado | OK — cabecera no legible en claro |
| contenido_no_legible | OK — el texto escrito no aparece en el archivo |
| clave_incorrecta_falla | OK — SQLite rechaza la lectura |
| clave_correcta_lee | OK |
| app_rechaza_sin_cifrado | OK — simulado sobre el runtime real (no se compiló un build sin SQLCipher) |
| temporal_subida_limpia_tras_fallo | OK |
| temporal_huerfano_eliminado | OK |

El primer intento falló por un error de la propia autoprueba (ruta del archivo de base sin `file://`); se corrigió, se
recompiló y se repitió.

## 5. Salud con el escáner detenido (API en contenedor)

Escáner activo: `status ok`, `scanner ok`. Escáner detenido: HTTP 200, `status degraded`, `scanner unavailable`,
`document_analysis UNAVAILABLE`. Registro: `validation-results/limpieza-2026-10-11/salud-escaner.txt`.

## 6. Pendiente

- Teléfono físico: autoprueba, captura real (foto y ubicación), cierre forzado, reinicio, vencimiento de sesión, cambio de
  cuenta, almacenamiento casi lleno y resolución de conflictos (`apps/mobile/README.md` § B).
- Fallo cerrado con un build nativo realmente sin SQLCipher (solo se probó la lógica en el runtime real).
- Recorrido completo de la interfaz en el emulador (login, captura, sincronización): no ejecutado.
