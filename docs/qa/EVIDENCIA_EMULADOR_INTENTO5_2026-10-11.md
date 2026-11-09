# Evidencia — recorrido en EMULADOR, intento 5 (2026-10-11)

APK: `apps/mobile/dist-apk/CANDIDATO-aceptacion-184cbfa8.apk`
(SHA-256 `184cbfa8763ac5662c576cd12571e897afaf13cde5ab5abf419345eef418f3d7`), reinstalado limpio antes del intento.
Emulador `tl-api30g` (Android 11, API 30, imagen google_apis x86_64). Cuentas DEMO, posición EMULADA, cámara virtual
(escena sintética). Resultado: `docs/qa/movil-emulador/recorrido.json`; registro con precondiciones:
`validation-results/emulador/recorrido-intento-5.log`; capturas: `docs/qa/capturas/movil-emulador/`.
Intento 4 archivado sin cambios (`recorrido-intento-4-defectos-script.json`, `capturas/movil-emulador/intentos-previos/intento-4/`).

**No acredita teléfono físico.**

## Resultado por paso

| Paso | Resultado | Clasificación |
| --- | --- | --- |
| Preparación (permisos por adb, posición EMULADA, proxy) | OK | — |
| Inicio de sesión online (tecnico1 DEMO) | OK | — |
| Descarga de asignaciones (5 parcelas) | OK | — |
| Captura de ubicación | OK | — |
| Foto (cámara virtual, metadatos quitados) | OK | — |
| Guardado sin conexión (proxy offline) | OK: 2 operaciones en cola | — |
| Cierre forzado y reapertura | OK: mismos identificadores antes y después | — |
| Interrupción tras commit (respuesta cortada) | OK: el servidor confirmó 2 operaciones, 1 muestra creada | — |
| Reintento | OK: sigue 1 muestra, mismos identificadores, sin duplicar | — |
| Foto sin análisis | OK: «análisis pendiente»; Documentos `SCAN_FAILED`, no descargable | — |
| Foto tras análisis | OK: Documentos `AVAILABLE`; la app la muestra disponible | — |
| Conflicto por edición web | OK: visible en la app (versión servidor 8) | — |
| Conflicto resuelto desde la app | OK: original `CONFLICT` conservada, nueva `ACCEPTED` enlazada | — |
| Cambio de cuenta, 1.ª ejecución | FALLA | **Automatización**: el botón de confirmar quedaba bajo el pliegue |
| Cambio de cuenta, 2.ª ejecución | FALLA | **Automatización**: la app no estaba en primer plano tras detener el recorrido |
| Cambio de cuenta, 3.ª ejecución | OK: aviso de 2 capturas sin enviar; tecnico2 no ve las de tecnico1; tecnico1 las recupera | — |
| Sesión vencida (reloj +2 h, en UTC) | OK: captura bloqueada, pendientes visibles | — |
| Reloj atrasado (−1 día) | OK: bloqueo por reloj atrasado | — |
| Dispositivo revocado | OK: «Este dispositivo fue revocado…»; capturas locales conservadas | — |
| Almacenamiento lleno, 1.ª y 2.ª ejecución | FALLA | **Automatización**: precondición de pantalla (pestaña / elemento fuera de vista); no se escribió relleno |
| Almacenamiento lleno, 3.ª ejecución | FALLA | **Defecto de la aplicación** (ver abajo) |

Precondiciones registradas por paso en el `.log`: reloj del emulador y `auto_time`, `adb reverse`, ausencia de relleno,
libre en C:, modo del proxy y estado del dispositivo. Orden real: la revocación se ejecutó antes del tercer intento de
almacenamiento lleno; capturar en local no requiere servidor.

## Defecto de la aplicación hallado

Con el almacenamiento del emulador lleno (relleno controlado), **crear un borrador** mostró el error técnico de SQLite en
inglés («Call to function 'NativeStatement.finalizeAsync' has been rejected… database or disk is full»), en lugar de un
mensaje en español con recuperación. La detección (`isStorageFull`) existía, pero la interfaz devolvía el mensaje crudo
si el error no era el propio de la app. Tras borrar el relleno, la cola seguía intacta (2 operaciones).
Corrección: `storageFullMessage()` en `src/core/ports.ts`, usada por la interfaz, con prueba unitaria. **Pendiente de
verificar en un APK nuevo**: `184cbfa8` contiene el defecto y no se entrega como apto.

## Defectos de automatización corregidos (intentos 4 y 5)

- Reloj: se formateaba en hora local del equipo (UTC−5) y el emulador usa UTC → ahora en UTC.
- `adb root` reinicia adbd y pierde `adb reverse` → se restablece tras `adb root`.
- Cierre de sesión: la tarjeta de confirmación reemplaza al botón y el botón de confirmar queda bajo el pliegue.
- Almacenamiento lleno: precondición de pestaña Inicio y espera de «Nueva captura».
- El primer `fallocate` (intento 4) dejó un relleno de 5,9 GB dentro del emulador; se borró. Ahora el relleno es
  **controlado**: exige ≥ 12 GB libres en C:, tramos de ≤ 1 GB midiendo C: tras cada uno y aborta (borrando el relleno)
  si C: baja de 10 GB. En el intento 5, C: se mantuvo en 19,61 GB antes y después.

## Disco

C: libre 19,48–19,63 GB durante el intento 5 (antes ~25 GB; la caída coincide con el relleno de 5,9 GB del intento 4,
que probablemente asignó el disco de datos del emulador en el equipo: no verificado). Con el emulador apagado: 23,75 GB.
