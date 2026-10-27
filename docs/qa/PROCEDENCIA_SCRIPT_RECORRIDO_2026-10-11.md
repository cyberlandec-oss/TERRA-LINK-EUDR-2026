# Procedencia del script de recorrido en emulador (2026-10-11)

Archivo: `e2e/movil/recorrido-emulador.mjs`. Este documento fija qué versión del script existe en cada commit y qué se
puede (y qué no) atribuir a cada ejecución registrada. No sustituye la evidencia de los intentos; la acota.

## Versiones versionadas (blob git)

| Commit | Fecha (−05:00) | Blob SHA-1 | Líneas |
| --- | --- | --- | --- |
| `aa0a478` | 12:13:58 | `fbc464b1fa0382f9cb8576b6ea002f91577c1443` | 272 |
| `0ba960a` | 15:04:53 | `2cd2e2ef65ba0c6611763cff50363446f5acb158` | 291 |
| `a8a327c` | 15:59:39 | `599a4649a7bfd6461741912a81d0c65704a9d72c` | 302 |

El script se creó y se fue reconstruyendo durante la sesión (pasos añadidos y corregidos entre intentos); cada commit
recoge la versión de trabajo de ese momento, no la de cada ejecución.

## Ejecuciones y atribución

| Ejecución | Hora del log | Qué dice el log | Atribución posible |
| --- | --- | --- | --- |
| Intento 5 | 14:31:37 (`recorrido-intento-5.log`) | sin versión de script | Versión de trabajo **sin commit**, posterior a `aa0a478` y anterior a `0ba960a`. No se puede afirmar que sea idéntica a ninguna de las dos. |
| Intento 6 | 15:58:22 (`recorrido-intento-6.log`) | «commit 0ba960a» (se refiere al commit del APK/árbol, no al script) | Versión de trabajo **sin commit**, posterior a `0ba960a` (el script cambió 41 líneas antes de `a8a327c`, un minuto después). Lo más probable es que coincida con `a8a327c`, pero **no está demostrado**: el log no registró huella. |

Consecuencias:
- Los resultados de los intentos 5 y 6 valen como evidencia del APK probado, no como prueba de que una versión
  concreta del script, tal como está en git, reproduce ese recorrido.
- No atribuir los intentos 5 y 6 a `0ba960a` ni a `a8a327c` como versión exacta del script.

## Cambio desde esta fecha

Desde el commit que introduce este documento, cada paso registrado en `docs/qa/movil-emulador/recorrido.json` incluye
`script: { sha256, commit, modificado_sin_commit }`. Una ejecución con `modificado_sin_commit: true` se atribuye solo a la
huella `sha256`, no al commit.
