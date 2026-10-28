# Evidencia: Altas completas, mapa móvil y APK en emulador (2026-10-28)

Alcance: DONE_LOCAL **no** otorgado; P0-023 y P0-024 siguen **ABIERTAS**. Emulador Android 15 (x86_64, `TL_Pixel_35`), **no** teléfono físico (`.claude/rules/40-mobile-offline.md`: el emulador no cierra el gate).

## Código, validación, despliegue y APK
| Qué | Valor |
| --- | --- |
| Código del candidato | `dd0f92d` (Altas, mapa, referencia de productores) y `b995aa3` (arneses e2e) |
| Validación raíz (una sola vez, árbol congelado) | **APROBADA** sobre `b995aa3`: `validation-results/2026-10-28T19-23-40-309Z` (typecheck, lint, build, OpenAPI, unitarias+integración 916,8 s, E2E 280,8 s) |
| Despliegue | `/version` = `b995aa3`, esquema `0071` (sin migración nueva, sin respaldo) |
| Pruebas móviles (aparte: la validación raíz no incluye `apps/mobile`) | `tsc --noEmit` y `jest --ci`: 60 pasaron, 1 omitida (humo opcional contra API) |
| APK vigente | `apps/mobile/dist-apk/CANDIDATO-mapa-altas-0f68196.apk`, commit **`0f68196`** (solo móvil + arneses sobre `b995aa3`), SHA-256 **`bb9cea2fba3f24f65b5440d8b89f691e122c1106fac1427c3aab3cc416998095`**, release x86_64 |
| APK previo del mismo recorrido de Altas | compilado de `dd0f92d` (misma lógica de Altas; `0f68196` solo quitó una atribución duplicada y fijó `minzoom` 6 de teselas) |

## Entorno Android (sin alterar nada ajeno)
JDK 17.0.20.1, SDK 36 + build-tools 36.0.0 + NDK 27.1.12297006 + imagen `google_apis` API 35 en `C:\Users\mario\Android` (variables solo por sesión). WHPX utilizable. Se aceptaron las licencias del SDK de Android para instalarlo. Cartografía: `node infra/maps/preparar-mapa.mjs` generó `ecuador.pmtiles` (150 MB, extracto Geofabrik 2026-10-27) porque el volumen `map-data` estaba vacío.

## Mapa móvil (decisión técnica)
WebView (`react-native-webview` 13.16.1) con MapLibre GL JS 6.15.0 **embebido** (misma versión que la web; sin CDN), estilo `infra/maps/estilo.json` sin capas de texto (no hay tipografías en el dispositivo). Las teselas salen de la base cifrada de la cuenta (`map_tiles`, migración local 7), preparadas con conexión por lecturas de rango del PMTiles del servicio `maps` del propio despliegue (puerto 8090). Ningún proveedor nuevo; no se envían parcelas ni capturas. Dibuja vértices (verde/ámbar/rojo según precisión y `mocked`), ubicación guardada y la lectura de «Mi ubicación» con su círculo de precisión; **nada se guarda al localizarse**. Estados explícitos: sin cartografía preparada / fuera de la zona preparada / lista.

## Resultados en emulador (último resultado por paso; `docs/qa/movil-emulador/recorrido.json`)
| Paso | Resultado | APK |
| --- | --- | --- |
| Productor autorizado sin parcelas visible tras la descarga | OK | dd0f92d |
| Primera parcela sin conexión → capturas (ubicación + 3 vértices) → cierre forzado → reapertura conserva la cola | OK | dd0f92d |
| Sincronización en dependencia: parcela definitiva con el productor correcto, 3 vértices, 1 muestra; reintento sin duplicar | OK | dd0f92d |
| Mapa sin cartografía lo dice; lectura mostrada sin guardar; revisión de vértices | OK | dd0f92d / 0f68196 |
| Preparar cartografía (50 teselas, 0,7 MB) y mapa **sin red ni servicio de mapas** | OK (captura `93-mapa-offline.png`) | 0f68196 |
| Adjunto interrumpido (respuesta de subida cortada) queda «archivo pendiente de subir» y el reintento no duplica | OK | 0f68196 |
| Conflicto visible → reenviar sobre la versión actual → resuelto con historial | OK | 0f68196 |
| Cambio de cuenta: otra cuenta no ve capturas; cerrar sesión avisa de pendientes | OK | 0f68196 |
| Reloj atrasado bloquea; dispositivo revocado | OK | 0f68196 |
| SQLCipher activo y autoprueba | OK (`cipher_version=4.7.0`, cabecera no legible, clave incorrecta falla) | 0f68196 |
| Respuesta perdida tras commit (`cortarTrasCommit`) | la interrupción se produjo (1 muestra creada); el paso de reintento **no se completó** por la deriva del arnés | 0f68196 |

**No re-demostrado con este APK** (el arnés quedó desalineado con el estado acumulado del dispositivo —decenas de borradores locales—, no se atribuye a un defecto de la app sin probarlo): persistencia tras cierre forzado de la captura clásica, reintento sin duplicar tras respuesta perdida, foto con análisis pendiente/disponible, ubicación denegada, sesión vencida, almacenamiento lleno. Estos seis se demostraron con el APK `9996a9b4` el 2026-10-11 (`docs/qa/EVIDENCIA_APK_9996a9b4_Y_NEGATIVA_2026-10-11.md`) y deben repetirse sobre `0f68196` desde un dispositivo limpio. El mapa en el emulador usa WebGL por software: la fluidez real se comprueba en el teléfono.

## Revisión visual de «Altas» (vista previa web, servidor simulado)
`node e2e/review/movil-altas-web.mjs` (10 pasos, 390 px): sin permisos (no pide descargar nada), vacío con permisos, productor sin parcelas elegible, primera parcela, productor rechazado → corrección → recuperación de dependientes (3 «Registrado en el servidor»), entrega rechazada corregible y de intervención externa, rol Productor solo con parcela. Capturas en `docs/qa/capturas/movil-altas/`. Defecto hallado y corregido: cinco pestañas recortaban «Diagnóstico» (+2 px de desborde).
En emulador real también se vio y se registró: los deslizamientos sobre el mapa lo mueven en vez de desplazar la página (se deja el borde izquierdo libre; mejora de UX pendiente).

## Recorridos por rol y cadena (web, despliegue `b995aa3`)
`node e2e/review/web-por-rol.mjs`: **APROBADO** (22 combinaciones, 19 cuentas vigentes, sin crear usuarios). `node e2e/review/cadena-integral-web.mjs`: T1–T14 OK; **bloqueos esperados** conservados (riesgo D-05.B, expediente D-07.5/7.6, despacho con 3 comprobaciones bloqueantes); **T15 NO DEFINIDO** (traspaso entre organizaciones). Satélite: servidor controlado/fixture; **Whisp real no ejecutado** (`WHISP_API_KEY` vacía y sin autorización expresa de envío).
