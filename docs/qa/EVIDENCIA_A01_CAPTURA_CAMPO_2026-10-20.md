# Evidencia A-01 — Captura de campo desde la web con alcance propio (2026-10-20)

Ampliación autorizada **posterior** a la documentación original (RF-48, `docs/03`; historia A-01, `docs/18`). **No altera** los
criterios de P0-006 a P0-010, P0-023/P0-024 ni P0-028, y **no entra** en los conteos 42/60 ni 30/44. Estado tras esta entrega:
**DONE_LOCAL** de A-01 (implementación, validación y demostración local). No acredita producción, Android real, conformidad EUDR
ni resultados satelitales reales.

## 1. Candidatos y validaciones (cada uno con su propio resultado)

| SHA | Resultado | Registros | Causa / nota |
| --- | --- | --- | --- |
| `90bf744` | **FALLIDA** | `validation-results/2026-10-20T18-07-07-037Z` | `catalog.spec.ts` seguía esperando que el Productor no tuviera permisos de productor/parcela (defecto de la expectativa; no se detectó antes por correr solo pruebas dirigidas) |
| `f86340d` | **FALLIDA** | `validation-results/2026-10-20T18-42-01-689Z` | E2E, 3 de 73. **Regresión real**: tras recargar, la ficha volvía al método «ubicación del navegador» y ocultaba el borrador de polígono y la importación pendientes; el resumen de precisión había perdido «vértices» |
| `0caed16` | **APROBADA**, no desplegada como cierre | `validation-results/2026-10-20T19-26-50-519Z` | 89 suites · 970 pruebas · E2E 83. Corrige lo anterior. Se desplegó provisionalmente y quedó superada |
| `6af11a8` | **APROBADA**, no desplegada | `validation-results/2026-10-20T21-45-48-297Z` | 89 suites · 970 pruebas · E2E 83. Corrige la **regresión de fotografías** (ver §6) |
| **`4913dd3`** | **APROBADA** | `validation-results/2026-10-20T23-04-37-016Z` | typecheck, lint, build, OpenAPI validado, **89 suites · 972 pruebas**, E2E **88**. **SHA desplegado** |

Cada aprobación se refiere solo a su SHA; ninguna se hereda del anterior.

## 2. Despliegue de `4913dd3`
`node scripts/desplegar.mjs` → `/version`: commit `4913dd3` (BUILD_ARG), esquema `0057_a01_alcance_propio_productor`, coincide con lo construido.
Perfil `app` con el servicio nuevo `maps` (healthy); la web sirve su propio worker de MapLibre (`/maplibre/…` → 200). `SATELLITE_LIVE_CALLS=disabled`;
volúmenes anteriores intactos (se añadió `terra-link_map-data`).

## 3. Demostración local (`e2e/review/a01-demostracion.mjs`)
Organización sintética «ENSAYO A-01» más otra organización ajena, con 8 roles; contraseñas generadas en memoria, fuera del repositorio.
Capturas (no versionadas): `validation-results/a01-demostracion-2026-10-20/`. Las corridas previas incompletas del guion (organizaciones `75826f`,
`c5ad99`, `69280c` y `4d1dc8`: errores del guion —forma de una respuesta, campos de estado forjados que la API rechaza con 400, y una
comprobación de «sin EXIF» que contaba como metadato el segmento mínimo de orientación que el contrato D-41 conserva a propósito—) se
conservan como datos sintéticos; la corrida válida es la de la organización `a9d148`.

### Fase base · ENSAYO a9d148 · 27/27 OK

| Caso | Resultado | Detalle |
| --- | --- | --- |
| 1.1 productor SIN vínculo: no ve parcelas (control: el vinculado ve la suya) | OK | sin vínculo=0, vinculado=1 |
| 1.2 parcela propia 200 / ajena (otro productor de la MISMA organización) 404, incluso por identificador | OK | propia=200 ajena=404 productor ajeno=404 |
| 1.3 técnico: solo parcelas de productores ASIGNADOS (tec1→C: sí; tec1→D: 404; tec2→D: sí) | OK | 200/404/200/404 |
| 1.4 otra organización: ni la administración ajena ni un productor con el mismo identificador acceden | OK | adminB=404 prod1→orgB=404 control admin=200 |
| 1.5 auditor y comprador: sin facultades de captura (control: el auditor SÍ lee) | OK | 200/403/403/403 |
| 1.6 gerente: lectura de la organización completa según su rol (control: ve las 4 parcelas) | OK | parcelas visibles=4 |
| 1.7 capturar NO es decidir: el productor no evalúa GIS, no encarga satélite, no ve riesgo ni miembros | OK | 403/403/403/403 |
| 2.1 control: la administración extrae el documento de D y repite con la MISMA operación (reintento idempotente) | OK | 1.ª=201 reintento=201 |
| 2.2 el reintento idempotente con la operación AJENA no revela el documento (tec1, prod1, prod3: nunca 2xx ni texto) | OK | 9 intentos denegados, sin datos del documento |
| 2.3 el documento de otro productor no se lista, no se abre ni se descarga para el productor vinculado | OK | en lista=false abrir=404 descargar=404 |
| 3.1 versión REGISTRADA (lazo): campos de estado enviados por el cliente se RECHAZAN; sin ellos se guarda y queda marcada no válida | OK | envío con estado forjado=400 (versiones=0) · lazo limpio=201 · technically_valid=false · lectura posterior=false |
| 3.2 resultado de VALIDACIÓN GIS: INVALID, y la parcela no pasa el perfil de destino (no exportable) | OK | GIS=INVALID · perfil=DOES_NOT_MEET exportable=false |
| 3.3 geometría UTILIZABLE: solo una versión técnicamente válida y evaluada pasa; la corrección crea versión nueva y el lazo queda en el historial | OK | versiones=2 · GIS vigente=VALID |
| 3.4 estructura inválida por la API directa: rechazada (4xx) y sin versión | OK | HTTP 422 |
| 4.1 WEB productor (es): elige su parcela, escribe coordenadas, REVISA sin guardar, guarda, corrige con motivo, adjunta evidencia | OK | parcela ajena en el selector=0 · versiones tras revisar=0 · guardar sin motivo bloqueado=true · versiones finales=2 |
| 4.2 WEB técnico asignado (es): croquis con teclado, revisión del servidor, guardado; no ve productores no asignados | OK | productores visibles=[A01-D · Finca D (sintética)] · método=MANUAL_COORDINATES · precisión=no informada |
| 4.3 WEB en inglés y 390 px (productor): mismo recorrido traducido, orden de coordenadas visible, sin desborde ni claves | OK | orden visible=true · sin desborde horizontal=true |
| 4.4 RECARGA: el borrador de POLÍGONO se retoma; recuperarlo NO guarda ni confirma; solo de su usuario, organización y parcela | OK | vértices recuperados=2 · versiones antes/después=2/2 · otros=404/404/404 |
| 4.5 RECARGA: la IMPORTACIÓN GeoJSON pendiente se retoma; no se confirmó sola; solo la ve quien tiene alcance | OK | pendientes del usuario=1 · versiones antes/después=1/1 · otros=404/404/404 |
| 5.1 WEB mapa (es): cartografía real, acercar/desplazar, fijar vértices (mira y teclado), REVISAR sin guardar y confirmar; ninguna solicitud externa | OK | vértices=3 · versiones antes/tras revisar=2/2 · método=MANUAL_COORDINATES, precisión=no informada · solicitudes=58 (al servicio local de mapas=12) · externas=0 |
| 5.2 WEB mapa (en, 390 px): teclado, sin desborde y sin solicitudes externas | OK | vértice fijado=true · sin desborde=true · externas=0 |
| 5.3 sin cartografía: lo declara, no usa mapa externo y conserva la entrada manual | OK | entrada manual disponible=true · externas=0 |
| 5.4 el productor usa polígono por vértices e importación GeoJSON SOLO en su parcela (la ajena: 404) | OK | propia=201/200 ajena=404/404 |
| 6.1 la API directa NO acepta una foto con EXIF (ni como FIELD_PHOTO ni como evidencia); la copia sin metadatos sí | OK | con EXIF=422 PHOTO_METADATA_PRESENT · imagen como evidencia=422 EVIDENCE_IMAGE_USE_FIELD_PHOTO · copia=201 · SHA de la copia ≠ SHA del original=true |
| 6.2 WEB: el productor sube una foto con EXIF; el sistema prepara la copia, el original no cambia y la ve y descarga | OK | descarga propia=200 · archivo servido sin metadatos=true · coincide con el SHA registrado=true · nombre neutro=true |
| 6.3 foto de OTRA parcela sin alcance: 404 al consultar, listar y descargar; el productor de ESA parcela sí; otra organización 404; sin identidad general | OK | otra parcela: ver=404, descargar=404, en lista=false · control (su productor)=200 · otra organización=404/404 · auditor=403 · identidad visible para el productor=false |
| 6.4 al retirar el vínculo el productor pierde el acceso a su foto al instante; al restablecerlo, vuelve | OK | antes=200 · retirado=200 → ver/descargar=404/404 · restablecido=200 → descargar=200 |

### Fase satelite · ENSAYO a9d148 · 6/6 OK

| Caso | Resultado | Detalle |
| --- | --- | --- |
| S.0 modo ensayo declarado por la API, con escenarios; el productor NO puede encargar | OK | ensayo_mode=true · escenarios=9 · productor=403 |
| S.1 con hallazgos / sin hallazgos: rotulado ENSAYO, sintético, conclusión NO evaluada, versión geométrica exacta | OK | hallazgos=3 · sin hallazgos=0 · versión analizada = vigente (1a00f128…) |
| S.2 cobertura insuficiente y error: se declaran; el error no deja resultado favorable; el reintento es un encargo nuevo | OK | cobertura=PARTIAL · error=FAILED (resultado=null) · reintento=COMPLETED, el fallido se conserva |
| S.3 sin efecto operativo: ni evidencia, ni evaluaciones de riesgo; el estado de la parcela sigue NOT_EVALUATED | OK | estado=NOT_EVALUATED · evidencias antes/después=0/0 |
| S.4 cambiar la geometría: los resultados anteriores NO aplican a la versión vigente | OK | nueva versión=201 · ningún ensayo aplica a la vigente=true |
| S.5 WEB administración (es y en): panel de ENSAYO con escenario elegible, ficha sin conclusión (capturas) | OK | selector de escenario es/en=1/1 |

### Fase cierre · ENSAYO a9d148 · 1/1 OK

| Caso | Resultado | Detalle |
| --- | --- | --- |
| C.1 la API declara fixture apagada: sin modo ensayo ni escenarios, no se puede encargar | OK | ensayo_mode=false · escenarios=0 · can_request=false · intento de encargo=409 |

### Geometría inválida: tres estados distintos (se conserva el diseño original de P0-006)
1. **Versión registrada**: un lazo (autointersección) se guarda como versión marcada `technically_valid=false`; un envío con `technically_valid`/`status` forjados se rechaza con 400 y no crea versión.
2. **Resultado de validación GIS**: la evaluación da `INVALID` y el perfil de destino `DOES_NOT_MEET`, `exportable=false`.
3. **Geometría utilizable**: solo una versión técnicamente válida y evaluada (`VALID`/`WARNING`) pasa; la corrección crea una versión nueva con motivo y el lazo queda en el historial. La estructura inválida (rango, tipo) se rechaza con 4xx. El botón de la web no deja confirmar una forma no válida; es una ayuda, **no** el contrato de almacenamiento.

## 4. Mapa base local (autorizado el 2026-10-20)
«Dibujar sobre el mapa» se cumple con **cartografía real y local**. Antes se había registrado como «croquis» (una reducción de la instrucción);
el croquis sin mapa base queda solo como alternativa cuando faltan los datos cartográficos.
- **Fuente**: OpenStreetMap, extracto de Ecuador de Geofabrik del **2026-10-19** (`ecuador-261019.osm.pbf`, MD5 publicado verificado), ODbL 1.0; esquema OpenMapTiles (CC-BY 4.0).
- **Preparación reproducible**: `node infra/maps/preparar-mapa.mjs` (Planetiler 0.10.2 → PMTiles de 150 MB; tipografías Noto Sans de openmaptiles/fonts v2.0). Almacenamiento: volumen `terra-link_map-data` (derivado, regenerable; su `metadata.json` se guarda en cada respaldo).
- **Servicio**: `maps` (nginx de solo lectura, lista de permitidos; las fuentes crudas no se publican). **Cliente**: MapLibre GL JS + pmtiles; el worker se sirve desde la propia web; cualquier URL que no sea del servicio local se bloquea.
- **Red**: el E2E y la demostración registran cada solicitud del navegador: solo web, API y servicio local de mapas (58 solicitudes en la demostración, 12 al servicio de mapas, **0 externas**); lo mismo en inglés a 390 px y sin datos cartográficos.
- **Límites**: referencia visual; no acredita límites de propiedad, precisión GPS, deforestación ni conformidad; **no** se ajustan vértices a elementos del mapa; el detalle es el que tenga OSM (rural: poco); teselas hasta el zoom 14 (más cerca se amplía sin añadir detalle); WebGL necesario (si falta, se declara).
- **Sin datos**: si el estilo o las teselas no responden, la pantalla lo dice («La cartografía local no está disponible»), no usa otro mapa y deja la tabla de coordenadas y el croquis.

## 5. Pruebas automáticas de A-01
- `apps/api/test/a01-alcance-propio.int-spec.ts` (15): vínculo explícito y auditado; solo lo propio; procedencia `MANUAL_COORDINATES` sin precisión; parcela ajena; capturar ≠ decidir; técnico y asignaciones con la **regresión de extracción** (ver, extraer, decidir sobre documento ajeno → error sin datos); revisión previa que no guarda y confirmación que revalida; **fotografías** (contrato D-41 y consulta propia); polígono por vértices e importación GeoJSON del productor; auditor/comprador; gerente y otra organización; obsolescencia de evaluaciones; desvincular.
- `apps/api/test/satellite.int-spec.ts` (29): escenarios de ensayo, versión exacta, sin evidencia ni riesgo.
- `apps/api/src/authz/catalog.spec.ts`: permisos **exactos** del Productor (`producer:read_own`, `plot:create_own`, `plot:read_own`, `plot:read_geometry`, `plot:update_own`; lectura de fotos propias por `document:read_field_photo_own`).
- `e2e/tests/captura-campo.spec.ts` (7), `e2e/tests/mapa-captura.spec.ts` (4) y los E2E de GeoJSON, polígono, parcelas y ubicación ajustados al selector de método.
- `apps/web/lib/i18n.test.ts` y `image-metadata.test.ts`.

## 6. Fotografías y EXIF (D-41) — contraste con la fuente
**Contrato previo** (`docs/11`, D-41; app móvil y `sync.ts`): la fotografía de campo es `FIELD_PHOTO`, **dato personal**; el cliente quita EXIF/XMP/IPTC/comentarios
(solo orientación) **antes del hash**; el servidor rechaza con `PHOTO_METADATA_PRESENT` lo que traiga metadatos; el SHA-256 es el de la copia procesada.
**Regresión detectada** (candidato `0caed16`): el recorrido web subía imágenes como `FIELD_EVIDENCE` (clasificación operativa) con su EXIF íntegro, eludiendo la clasificación. Se había presentado como limitación; era una regresión.
**Corrección** (`6af11a8`): la web prepara una copia sin metadatos con la misma regla (el **original no se modifica**), nombre neutro, `FIELD_PHOTO`; el servidor rechaza una imagen con metadatos (auditado) y las imágenes como `FIELD_EVIDENCE` (que queda para PDF).
- **Original**: permanece en el equipo de la persona; no se almacena. **Metadatos como evidencia**: no se conservan ni se usan como prueba (la ubicación de la parcela se registra aparte, con su procedencia). **Archivo servido/descargado**: exactamente la copia almacenada (comprobado byte a byte).
- **Consulta propia** (decisión 2026-10-20): el productor vinculado consulta y descarga las `FIELD_PHOTO` de **sus** parcelas con `document:read_field_photo_own`, sin `producer:read_identity`; el alcance por titular se comprueba al consultar y al obtener el contenido; la clasificación de dato personal y la auditoría no cambian. Demostrado: foto propia 200; otra parcela 404; otra organización 404; auditor 403; pérdida de acceso al retirar el vínculo y recuperación al restablecerlo.

## 7. Interruptor del ensayo satelital
`SATELLITE_FIXTURE_ENABLED` se habilitó **solo** durante la fase satélite (API y worker, verificado con `printenv` en ambos contenedores) y se retiró de `.env`. Tras recrear
api y worker: `false` en **ambos**; la API declara `ensayo_mode=false`, sin escenarios, `can_request=false`, y un intento de encargo responde 409 sin resultado. `SATELLITE_LIVE_CALLS=disabled` no se tocó.

## 8. Respaldo
`_respaldos/2026-10-20-a01-mapa-fotos-0057` (tomado con `4913dd3` y la demostración ya ejecutada) — restauración aislada verificada: 137 tablas, conteos exactos idénticos, restricciones idénticas,
descifrado de identidad OK (53 productores, 0 fallos), 1191 objetos con la misma huella; `FIELD_PHOTO` = 8, vínculos propios = 10. Incluye `metadata-mapa.json`; **no** incluye el volumen del mapa (regenerable). El anterior `…-a01-migracion-0057` se conserva.
La organización de prueba manual (`e2e/review/a01-preparar-prueba-manual.mjs`) se creó **después** del respaldo.

## 9. Límites (precisos)
- Datos y análisis satelital **sintéticos**; ninguno acredita deforestación, su ausencia ni conformidad.
- Ensayo físico Android **pospuesto** (P0-023/P0-024 conservan sus criterios con teléfono pendientes).
- **Captura web sin conexión: no existe.** El offline es del móvil; la web no persiste capturas sin servidor. Es una limitación conocida, **no** un criterio de A-01 (no pertenece al alcance acordado) y no se añadió retroactivamente.
- **Textos desconocidos**: lo que redacta el servidor y no tiene entrada en el diccionario inglés se muestra en español (reserva prevista por ADR-0007); páginas de productores y del detalle de documento solo parcialmente traducidas.
- El croquis sin mapa base y la tabla de coordenadas son alternativa, no sustituto, del mapa. Mapa: detalle rural limitado a OSM; requiere WebGL.
- El productor no ve la identidad del productor ni fotos de otras parcelas; la identidad sigue siendo de quien tiene `producer:read_identity`.

## 10. Aclaración de alcance del propietario (2026-10-21)
Se registra sin reconstruir A-01 ni repetir sus validaciones: la documentación raíz gobierna; los roles canónicos y sus permisos base se conservan; A-01 añade capacidades concretas (Productor sobre sus parcelas vinculadas, Técnico sobre asignados, Administrador dentro de su organización, Gerente según sus permisos vigentes) sin facultades sobre otros módulos; capturar no concede análisis satelital, aprobar evidencias ni concluir riesgo; mapa base, geometría y resultado satelital siguen separados; la web no sustituye el ensayo físico móvil.
**Contraste:** comparando el catálogo efectivo de `1859aa0` y `4913dd3`, A-01 añadió permisos de alcance propio a PRODUCER y ORG_ADMIN (dentro del alcance) y **un único permiso fuera de él**: `producer:link_self` al **Gerente** (administración de accesos, no captura). Se corrige quitándolo del Gerente, conservando sus permisos de gestión. Detalle en `docs/07` («Aclaración de alcance del propietario»). Los resultados de esta evidencia (validación de `4913dd3`, demostración, respaldo) **no cambian** y siguen atribuidos a ese SHA.
