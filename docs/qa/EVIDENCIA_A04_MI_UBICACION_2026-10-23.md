# Evidencia — A-04 «Mi ubicación» en la captura geográfica de parcelas (2026-10-23)

**Alcance:** mecanismo implementado, validado en local, demostrado con **posición EMULADA** y verificado en **emulador** Android. **No** acredita una lectura de GPS real,
un teléfono físico, producción ni conformidad EUDR. Fuera del conteo de requisitos aceptados (42/60; MVP 30/44), que no cambia.

## 1. Qué hace (y qué no)
- Botón «Mi ubicación» (icono + etiqueta accesible) junto a los controles del mapa. Pide la posición en **primer plano y a petición**, muestra «Obteniendo ubicación…», **evita solicitudes simultáneas**,
  centra el mapa, dibuja un marcador diferenciado y el círculo de precisión, y muestra precisión, hora y fuente. Se puede volver a localizar después de mover el mapa.
- **Localizarse no guarda ni cambia nada**: no crea una versión, no mueve geometrías, no sustituye borradores ni añade vértices.
- **Incorporar la lectura exige una acción explícita**: «Añadir vértice aquí» / «Usar como punto» (o «Reemplazar el punto con esta posición», si ya había uno, etiquetado así) en el mapa de dibujo;
  «Añadir vértice aquí» en el polígono por vértices y «Usar como punto de referencia» en el punto del navegador abren la **misma revisión de muestra de siempre**, que solo se guarda con «Guardar vértice» / «Guardar como nueva versión».
- **Cada lectura conserva SU precisión y SU hora; nunca se atribuye al polígono.** En el borrador por vértices cada vértice se guarda con su `horizontal_accuracy_m` y su procedencia `BROWSER_GEOLOCATION`. En el dibujo manual
  la versión sigue siendo `MANUAL_COORDINATES` sin precisión (no se promueve a medición); los vértices tomados de «Mi ubicación» se rotulan en la tabla, en la revisión y en las notas con su propia precisión, y **pierden esa procedencia si se editan o se arrastran**.
  Los vértices dibujados siguen siendo manuales.
- **No se inventa nada ni se usa una lectura vieja:** una precisión ausente queda «no informada»; una lectura de más de 60 s obliga a localizarse otra vez antes de usarla. «Aproximada» (> 100 m o sin precisión) es un **aviso orientativo de la interfaz**, no un criterio de validez ni regulatorio, y no bloquea.
  En un computador la ubicación suele ser aproximada (red/IP); nunca se presenta como medición GPS.
- Errores con recuperación: permiso denegado, no disponible, espera agotada y sin soporte; reintento y la captura manual siguen disponibles. Sin seguimiento ni segundo plano; sin proveedor cartográfico externo.
- **Roles:** sin permisos ni roles nuevos; solo aparece donde ya hay captura o edición (Productor sobre sus parcelas vinculadas, Técnico según su asignación, Administrador, etc.). El auditor no ve el botón y la API rechaza su escritura (403).
- **Cabeceras de seguridad:** `Permissions-Policy: geolocation=(self), camera=(self), microphone=()` ya permite la geolocalización legítima del propio sitio (comprobado en el despliegue); se mantienen las demás restricciones.

Código: `apps/web/lib/mi-ubicacion.ts`, `mi-ubicacion-panel.tsx`, `map-capture.tsx` (vista de solo lectura y capa de lectura), `manual-capture.tsx`, `polygon-capture.tsx`, `location-capture.tsx`, `field-capture.tsx`;
`apps/mobile/src/core/ubicacion.ts` y `src/ui/screens.tsx`.

## 2. Inventario de pantallas cubiertas
| Pantalla | Cobertura |
| --- | --- |
| Web · Escribir o dibujar → «Dibujar en el mapa» (punto y polígono) | «Mi ubicación» + acción explícita; columna «Origen» por vértice |
| Web · Polígono por vértices (borrador en el servidor) | mapa de solo lectura + «Añadir vértice aquí» → revisión de la muestra |
| Web · Ubicación del navegador (punto de referencia) | mapa de solo lectura + «Usar como punto de referencia» → revisión |
| Web · Croquis sin mapa base, Importar GeoJSON | **sin cambios** (no hay mapa; no se añadió un botón sin sentido) |
| Móvil · Captura (ubicación del borrador) | «Mi ubicación» (lectura sin guardar) + «Usar esta ubicación en el borrador» / «Reemplazar…» |
| Pantallas sin relación geográfica y roles de solo lectura | **sin botón** |

## 3. Validaciones (todas conservadas en `validation-results/`)
| SHA | Resultado | Corrida |
| --- | --- | --- |
| `353d23e` | **FALLIDA** en E2E: 1 de 145 (`productos.spec.ts:72`); 21 no se ejecutaron por ser serial | `2026-10-23T02-09-54-506Z` |
| **`5f77b72`** | **APROBADA** (integración 2 402 s, e2e 433 s) | `2026-10-23T03-00-54-744Z` |

Diagnóstico de `353d23e`: el test pulsaba «Guardar cambios» justo después de «Recargar versión actual» **sin esperar a que terminara la recarga**; enviaba la versión vieja y volvía a dar conflicto. Es la misma carrera de test de `parcelas.spec` (corrida `3335cd1`, ya documentada).
Corrección en `5f77b72`: el test espera a que desaparezca el aviso de conflicto; ninguna aserción reducida ni plazo ampliado. Se revisaron los demás specs con ese patrón (los otros ya esperan el estado de la pantalla).
Cambios posteriores a `5f77b72`: un guion de demostración, el guion del emulador, `apps/mobile/src/ui/screens.tsx` (ver §5) y documentación; **ninguno entra en lo que ejecuta `npm run validate`** (web/API/E2E), por lo que no se repitió.

## 4. Despliegue y demostración web (posición EMULADA)
- `5f77b72` desplegado (`/version` = `5f77b72`, esquema 0065); 27 volúmenes intactos.
- `node e2e/review/mi-ubicacion-demostracion.mjs`: **8/8**. Técnico DEMO asignado: «Mi ubicación» centra el mapa y muestra la lectura (± 15 m, hora, fuente) sin guardar; «Añadir vértice aquí» es explícito y con su precisión; ubicación aproximada anunciada sin bloquear;
  permiso denegado con mensaje, reintento y captura manual; inglés y 390 px sin códigos ni desborde; auditor sin botón y con 403 en la API; **muestras/versiones/borradores/historial idénticos antes y después (1/45/9/85)**. Capturas en `validation-results/mi-ubicacion-2026-10-22/`.
- La primera ejecución dio 7/8: el caso de 390 px falló por un **defecto del guion** (leía el texto después de cerrar el contexto); corregido solo el guion y repetida sobre el mismo despliegue (8/8).
- Los casos que **sí guardan** (vértices con su precisión, versiones, borradores) corren sobre datos sintéticos aislados: `e2e/tests/mi-ubicacion.spec.ts` (9 pruebas, incluida la lectura vieja con `page.clock`).

## 5. Móvil: pruebas automatizadas y emulador (no es un teléfono físico)
- `apps/mobile/src/core/__tests__/ubicacion.test.ts` + 34 pruebas del núcleo, `tsc` y bundle Android: OK. `expo-doctor` falla por **6 parches de Expo más nuevos disponibles** (anterior al cambio; no se actualizaron dependencias).
- **APK `A04-mi-ubicacion-3df0ca8d.apk`** (`apps/mobile/dist-apk/`, no versionado). SHA-256 `3df0ca8d423637301f021584056ce9c5eb285885f25cac96a111d02b0edea41b`; commit `056d298`; árbol `apps/mobile` idéntico al de `5f77b72` salvo `screens.tsx`.
  **No equivale** al APK anterior (`APTO-ensayo-fisico-9996a9b4`), que se conserva sin tocar con su identificación.
- Compilado desde una copia exacta (`git archive`) en `C:\tlb\m`, porque la ruta del repositorio supera los 260 caracteres que admite `ninja` (intento 2: fallo de compilación; no se tocó ningún ajuste del sistema). La copia temporal `C:\tlb` quedó **sin borrar**: la comprobación de seguridad bloqueó su eliminación; puede borrarla el propietario.
- **Primer APK `6107e478` (commit `1b571f3`) — NO USAR.** En el emulador la lectura se mostraba, pero la `View` con `accessibilityLabel` ocultaba sus valores a la jerarquía de accesibilidad (un lector de pantalla solo habría leído «Lectura de Mi ubicación»). Corregido en `056d298`; se recompiló.
- Emulador `tl-api30g` (Android 11, Google APIs), posición **EMULADA** (`adb emu geo fix`), cuenta DEMO técnico, `docs/qa/movil-emulador/a04-3df0ca8d.json`: preparar, iniciar sesión, descargar 15 parcelas y **captura: la lectura se mostró sin guardar (el borrador seguía «Sin ubicación.») y solo se guardó con «Usar esta ubicación en el borrador»**. Verificado también que los valores (lat/lon, precisión 5 m, hora, procedencia, aviso de lectura > 60 s) aparecen en la jerarquía de accesibilidad. Autoprueba del APK: «todo correcto» (SQLCipher activo, archivo cifrado, clave incorrecta falla, almacén transaccional, rechazo sin cifrado).
- **Intentos de infraestructura fallidos (conservados):** (1) proxy del recorrido sin argumento de registro; (2) imagen `tl-api30` sin Google Play (el proveedor de ubicación no entregaba lectura: la app mostró correctamente el mensaje de recuperación); (3) guion que buscaba la tarjeta desplazándose en un solo sentido y una expresión regular sin escapar. Ninguno fue un defecto del producto salvo el de accesibilidad ya descrito.
- Limitaciones: la app **no incluye mapa** (no se promete mapa offline); la disponibilidad de ubicación y la de cartografía son cosas distintas. El recorrido registró un dispositivo de prueba y sesiones DEMO en la base local; no se sincronizó ninguna captura ni se cambió ningún dato de negocio.

## 6. Pendiente (no ejecutado)
Ensayo en **teléfono físico** con ubicación real (incluida la denegación del permiso) al final, según lo acordado; revisión independiente de ciberseguridad; CSP (evaluación).
