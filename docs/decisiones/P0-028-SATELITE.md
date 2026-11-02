# P0-028 — Primer proveedor satelital: contrato, propuesta de proveedor y alcance implementable (2026-10-14)

Fuentes contrastadas, con su cita literal:

- **Backlog P0-028**: «Depende P0-010/019/020. Como EUDR_MANAGER, necesito resultado con procedencia. Aceptación:
  adapter/job, contrato real y coste, credenciales protegidas, dataset/versión/fecha/método/cobertura; timeout/no
  coverage no generan verde; defensa egress/SSRF probada. RF-28; QA-15.»
- **RF-28** (docs/03): «Proveedor satelital sustituible con procedencia y fallo explícito.»
- **QA-15** (docs/16): «Satélite ok/timeout/rate limit/no coverage, redirects y URL maliciosa → Proveniencia; fallo
  explícito; credencial no sale a destino ajeno; ningún verde falso.»
- **S1 §39**: «cuando existe riesgo regional se requiere análisis geoespacial a escala de parcela mediante superposición
  de la geolocalización con imágenes satelitales o mapas de cobertura/uso de suelo»; cadena `National/regional risk →
  Plot-level analysis → Satellite / land-cover evidence → Risk assessment`.
- **S1 §40**: «No acoplar el core a un único proveedor», interfaz `SatelliteProvider` con `getForestCover`,
  `getDeforestationAlerts`, `getHistoricalAnalysis`; implementaciones `WHISPProvider`, `GFWProvider`,
  `EUObservatoryProvider`, `CustomProvider`.
- **S1 §41**: «El resultado de un proveedor externo no debe convertirse automáticamente en verdad legal.» Guardar
  `source, dataset, version, analysis_date, resolution, method, result, confidence`.
- **S1 §52**: `GET /api/v1/plots/{id}/satellite`. **S1 §54**: worker `SATELLITE_ANALYSIS_REQUESTED`; «No bloquear una
  petición HTTP durante un análisis satelital». **S1 §67**: la pantalla de parcela muestra `Satellite` y
  `Deforestation`. **S1 §95** (Sprint 9): `Plot → Analysis Job → Provider → Result → Evidence → Risk`.
  **S1 §103**: «No acoplar el sistema a un proveedor satelital.»
- **docs/06**: `satellite_jobs/results` → `plot_version_id R; provider R; job_status R; dataset/version/date/method C;
  resolution/confidence C; raw_object_key C`; «C al completar; resultado ligado a geometría exacta».
- **docs/08**: eventos `SatelliteAnalysisRequested/Completed/Failed`.
- **docs/10 §Versionado e impacto**: «Una evaluación satelital o de riesgo utiliza `plot_version_id` y hash de
  geometría, no "la parcela actual" mutable»; «Las capas satelitales deben incluir proveedor, dataset, versión, fecha,
  resolución, método, cobertura, límites y confianza si el proveedor la define. "Sin alertas" no equivale a "sin
  deforestación" cuando no existe cobertura suficiente.»
- **docs/13**: regla `SATELLITE_COVERAGE_UNKNOWN` → «NOT_ASSESSED y revisión requerida; sin alertas no prueba ausencia
  de deforestación».
- **docs/15 §Contrato de adapter satelital** y §Seguridad de llamadas externas (texto íntegro aplicado abajo).
- **docs/UX_UI §661**: «Análisis satelital: solicitado, en cola, en proceso, fallido o disponible según contrato de job.
  Resultado muestra fecha de análisis y del dataset, fuente y límites. Una alerta de cobertura requiere interpretación;
  no escribir "deforestación confirmada" por el solo resultado de un proveedor.»
- **docs/22 D-09**: «Proveedor satelital y cobertura/coste — Evidencia de cierre: canal/contrato/fixture/resultados
  reales.» **Decisión abierta.**

Validación local. Este documento no acredita producción, contratación de proveedor ni conformidad EUDR.

---

## 1. Qué análisis exige la fuente

Las fuentes **no definen un algoritmo de deforestación propio ni umbrales**. Exigen tres cosas distintas y es
importante no confundirlas:

| Exigencia de la fuente | Qué significa aquí | Quién la cumple |
| --- | --- | --- |
| Superposición de la geolocalización de la parcela con imágenes satelitales o mapas de cobertura (S1 §39) | Se **envía la geometría** de la parcela a un proveedor que mantiene esas capas y se **recibe** su resultado | El proveedor externo, no Terra Link |
| Arquitectura no acoplada a un proveedor (S1 §40/§103) | Puerto `SatelliteProvider` + registro de proveedores sustituibles | Terra Link |
| El resultado externo no es verdad legal (S1 §41) | Procedencia completa, resultado conservado **sin interpretar**, conclusión regulatoria fuera del proveedor | Terra Link |

**Consecuencia de contrato:** P0-028 no «calcula deforestación». Encarga un análisis, conserva su procedencia y lo deja
disponible como insumo. Ninguna salida de esta historia dice «libre de deforestación» ni «conforme EUDR».

## 2. Geometría y versión utilizadas

- El sujeto del análisis es una **versión de parcela** (`plot_version_id`), nunca «la parcela actual» (docs/10).
- El trabajo guarda además el `geometry_hash` de esa versión. Un resultado **solo es aplicable** a la versión cuya
  huella coincide; si la parcela cambia de geometría, el resultado anterior queda `SUPERSEDED_GEOMETRY` y **no se
  reutiliza** (no se migra silenciosamente a la geometría nueva).
- Una versión **sin geometría** (solo superficie declarada) no es analizable: `GEOMETRY_UNSUPPORTED`. No se sustituye
  por el centroide del cantón ni por ningún dato inventado.
- Un trabajo atrasado **no sobreescribe** el estado de una versión posterior (docs/13 §Evaluación reproducible: «un job
  atrasado no sobreescribe una evaluación posterior: comprobar versión objetivo»).

## 3. Proveedor, conjunto de datos y cobertura temporal

- **Registro de proveedores** (`satellite_providers`), catálogo de sistema versionado, con el mismo criterio que el
  catálogo de riesgo: nace **no seleccionado**. Campos: código, nombre, tipo, URL base y de documentación, licencia,
  coste, cobertura, límites, **qué datos salen del equipo**, fuente documental y estado de selección.
- Estados: `PROPOSED` (documentado, sin decisión) · `SELECTED` (decisión D-09 registrada, con responsable y referencia)
  · `TEST_ONLY` (fixture sintética) · `RETIRED`.
- **A lo sumo un proveedor `SELECTED`** (índice único parcial). Hoy: **ninguno**.
- Una fixture **nunca** puede quedar `SELECTED` (restricción de esquema) y sus resultados se marcan
  `is_synthetic = true` de forma indeleble.
- El dataset, su versión y la cobertura temporal **los declara el proveedor en cada resultado**; Terra Link no los
  presupone ni los rellena. Si el proveedor no los informa, el campo queda nulo y el resultado queda `INCOMPLETE`.

## 4. Resultados, incertidumbre y estados no evaluables

Un trabajo termina **siempre** con un desenlace explícito. Ninguno de ellos es favorable:

| Desenlace | Cuándo | Lectura |
| --- | --- | --- |
| `RESULT_AVAILABLE` | El proveedor respondió con procedencia completa | Insumo con límites; **no** conclusión |
| `NO_PROVIDER_SELECTED` | No hay proveedor seleccionado (D-09) | No evaluable |
| `NO_COVERAGE` | El proveedor declara que no cubre la geometría o el periodo | No evaluable: «sin alertas» ≠ «sin deforestación» |
| `TIMEOUT` | Venció el plazo | No evaluable |
| `RATE_LIMITED` | Cupo del proveedor agotado | No evaluable |
| `PROVIDER_ERROR` | Error del proveedor o respuesta no conforme al contrato | No evaluable |
| `EGRESS_BLOCKED` | El destino no superó la defensa de salida | No evaluable **y** incidente de seguridad |
| `GEOMETRY_UNSUPPORTED` | La versión no tiene geometría o el tipo no es admitido | No evaluable |
| `SUPERSEDED_GEOMETRY` | La parcela cambió de versión antes de terminar | No evaluable para la versión vigente |
| `CANCELLED` | Cancelado por la organización | No evaluable |

Regla innegociable, además escrita como restricción de base: **`satellite_results.conclusion` solo admite el valor
`NOT_EVALUATED`**. Ningún resultado de proveedor, ninguna ausencia de alerta y ninguna confianza alta producen por sí
mismas una conclusión. La confianza se conserva **solo si el proveedor la define** (docs/10); en otro caso es nula y no
se infiere.

## 5. Procedencia, versiones y evidencia reproducible

Cada resultado conserva, según S1 §41 y docs/06: `provider_code`, `dataset`, `dataset_version`, `analysis_date`,
`resolution_m`, `method`, `coverage_status` + nota de cobertura, `confidence` (si el proveedor la define),
`limitations` (obligatorio), `indicators` (lo que devolvió el proveedor, **sin interpretar**), y la referencia a los
**bytes originales** (`raw_object_key` + `raw_sha256`) en el almacenamiento privado.

Además se conservan: la versión del contrato de adapter (`adapter_contract_version`), la versión del registro de
proveedores y el `request_fingerprint` (hash de lo que se envió: geometría + parámetros), para poder reconstruir la
petición exacta sin volver a enviarla.

`satellite_results` es **append-only** (trigger). Volver a analizar crea un trabajo y un resultado nuevos; nunca se
corrige un resultado histórico en su sitio.

## 6. Permisos y clasificación de coordenadas

- Permisos nuevos: **`satellite:read`** (consultar trabajos y resultados) y **`satellite:request`** (encargar un
  análisis). `satellite:request` **no** concede lectura de parcelas: cada operación revalida el alcance de la parcela.
- **Clasificación de coordenadas (decisión de esta historia, propuesta):** encargar un análisis **envía la geometría
  exacta fuera del equipo**. Por eso exige además **`plot:read_geometry`** —el permiso que ya clasifica el acceso a
  coordenadas exactas (docs/06, catálogo RBAC)—. Quien no puede ver las coordenadas tampoco puede hacer que salgan.
- La credencial del proveedor se guarda **cifrada por organización** (AES-256-GCM con AAD de contexto, el mismo
  mecanismo de datos personales), nunca se devuelve por la API, nunca se registra y solo se adjunta a un host de la
  lista blanca del proveedor seleccionado (docs/15).
- Los eventos y la bitácora registran identificadores y desenlaces: **nunca coordenadas, nunca la credencial, nunca el
  mensaje de error crudo** (solo un código controlado).

### Defensa de salida (egress/SSRF), exigida por QA-15

Antes de cualquier llamada: solo `https`; host en la **lista blanca del proveedor registrado**; sin credenciales en la
URL; sin literales IP; resolución DNS comprobada contra rangos **privados, loopback, enlace local, CGNAT, multicast y
ULA IPv6** (defensa frente a *DNS rebinding*); **ninguna redirección se sigue** (un 3xx es `EGRESS_BLOCKED`); plazo
máximo; tamaño máximo de respuesta; y redacción de la credencial en cualquier texto que se conserve.

## 7. Integración con riesgo y expedientes

- **Riesgo (P0-020).** La regla `SATELLITE_COVERAGE_UNKNOWN` del catálogo `0.1.0` tiene `depends_on = 'P0-028'` y
  resuelve `NOT_EVALUABLE`. **No se modifica en esta historia.** Que exista un adapter no la vuelve evaluable: para
  eso hacen falta (a) un proveedor **seleccionado** (D-09) y (b) una **versión nueva del catálogo** con la condición
  escrita y su aprobación (D-07). Cambiar la regla sin ambas cosas sería inventar el umbral que las fuentes no dan.
- **Expediente (P0-022).** El requisito `DEFORESTATION_ANALYSIS` deja de depender de una constante escrita en el código
  (`satellite_provider: null`) y pasa a derivarse del **registro de proveedores**: es `NOT_EVALUABLE` mientras no haya
  proveedor seleccionado, y los resultados **sintéticos nunca lo satisfacen**. El cambio es de procedencia, no de
  resultado: hoy sigue `NOT_EVALUABLE`.
- **Evidencia (P0-019).** S1 §95 encadena `Result → Evidence → Risk`. Vincular un resultado satelital como evidencia
  **queda fuera de esta entrega**, y conviene separar bien de qué depende:
  - **D-37** decide la **política de autoverificación y revisión** de una afirmación: quién no puede verificar lo que
    él mismo aportó, y con qué plazo se revisa tras una versión nueva. Es una política *sobre* las evidencias.
  - Lo que falta aquí es **otra cosa y se registra aparte, como D-42**: qué **tipo de afirmación** del catálogo de
    docs/12 es un resultado satelital, cuál es su **entidad titular**, **qué acredita y qué no**, si exige verificación
    humana o es evidencia de sistema con procedencia, y qué ocurre con ella cuando cambia la versión geométrica o la
    versión del dataset.
  - Orden: primero D-42 (qué es esa evidencia), después D-37 (quién la verifica). Ampliar D-37 para abarcar el
    contrato entero sería cambiarle el significado por la puerta de atrás.

---

## Propuesta de proveedor para D-09 (NO APROBADA)

Las fuentes **nombran candidatos pero no seleccionan**: S1 §40 lista WHISP, EU Observatory y GFW; docs/15 deja la
integración «WHISP/GFW/otro satélite» en `POR_VERIFICAR` con condición de activación «API, términos, cobertura, coste,
seguridad y credenciales comprobadas». Por tanto **no hay proveedor elegido** y esta sección es una propuesta
revisable, consultada en documentación oficial el 2026-10-14.

| | **Whisp (Open Foris / FAO · Forest Data Partnership)** | **Global Forest Watch (WRI)** | **EU Forest Observatory (JRC)** |
| --- | --- | --- | --- |
| Qué entrega | Indicadores por geometría («convergencia de evidencia») a partir de JRC TMF, Hansen GFC, alertas RADD y mapas por commodity | Datos y alertas de pérdida de cobertura (GLAD, RADD) por área de interés | Mapas GFC2020 / GFT2020 (cobertura y tipo de bosque, año 2020) |
| Interfaz | API REST documentada: `POST /api/submit/geojson` · `/api/submit/wkt` · `/api/submit/geo-ids`; `GET /api/status/{token}` (+ `/stream`, `/cancel`); descarga GeoJSON/CSV; `GET /api/config` | API con clave; portal de datos | Descarga, WMS y Google Earth Engine; **sin API por parcela** |
| Autenticación | Cabecera `x-api-key` (registro gratuito) | Clave de API (caduca al año) | No aplica |
| Resolución / corte | Muestreo a **10 m**; corte **31-12-2020** (el de EUDR); definición de bosque FAO (0,5 ha, 5 m, 10 % dosel) | Según dataset | **10 m**, año 2020 |
| Límites declarados | 5 000 geometrías por trabajo asíncrono / 250 síncrono; 30 peticiones por 60 s por clave; 2 trabajos simultáneos; plazo 600 s asíncrono / 90 s síncrono | Cupo por clave; atribución obligatoria | — |
| Licencia / coste | **MIT**, gratuito, uso comercial sin acuerdo con FAO | Gratuito y abierto; GFW **Pro** tiene acuerdo aparte con opciones de pago | Gratuito; «fuente no obligatoria, no exclusiva y **no jurídicamente vinculante**» |
| Datos que saldrían del equipo | **Geometría de la parcela** y parámetros técnicos; sin identificadores de usuario. Retención declarada: temporal durante el análisis, borrado típico en ~10 min; metadatos de petición con IP anonimizada a los 90 días | Área de interés | Ninguno (se consume el mapa) |
| Lo que **no** entrega | «You can use Whisp to support due diligence reports, **but there is no certification involved**»; devuelve «more info needed» cuando la evidencia es insuficiente | No concluye cumplimiento | No concluye cumplimiento |

**Propuesta para decidir (sin aprobar):** **Whisp** como primer proveedor, por dos razones comprobables: su contrato
asíncrono (`submit` → `status/{token}` → descarga) encaja exactamente con el modelo de trabajo que exige S1 §54, y su
corte temporal es el de la EUDR. GFW quedaría como segundo adapter (la sustituibilidad es el criterio de RF-28) y el
mapa del JRC como capa de referencia, no como proveedor por parcela.

**Precisión importante sobre la licencia:** la licencia **MIT** cubre el **código** de Whisp. **No** es aceptación de
los **términos del servicio alojado**, **no** es un acuerdo de nivel de servicio y, sobre todo, **no autoriza a
enviarle geometrías de productores**. «Gratuito y de código abierto» reduce la fricción de *construir* el adaptador;
no reduce en nada lo que hay que decidir para *usar* el servicio. Las dos aprobaciones están separadas más abajo.

**Lo que esta propuesta NO resuelve y debe decidirse antes de enviar una sola coordenada:**

1. **Autorización para que las geometrías de productores salgan del equipo** hacia un tercero (FAO/Google Earth Engine
   como infraestructura subyacente), y su base de tratamiento (D-14 retención y base del tratamiento).
2. Aceptación de los **términos de servicio** vigentes del proveedor por el responsable que corresponda.
3. Titularidad y custodia de la **clave de API** por organización o por plataforma.
4. Qué significa operativamente cada indicador del proveedor **antes** de que ninguna regla lo use (eso es D-07, no
   esta historia).

Mientras tanto, **no se contrata, no se registra clave y no se envía ninguna coordenada**.

---

## D-09: parte A ADOPTADA (2026-10-15), parte B pendiente

| Aprobación | Estado | Qué habilita hoy |
| --- | --- | --- |
| **A. Adaptador para desarrollo** | **ADOPTADA el 2026-10-15** (Whisp) | El adaptador está implementado contra el contrato oficial fechado y probado **solo contra servidores controlados**. `satellite_providers.WHISP = SELECTED_FOR_DEVELOPMENT` |
| **B. Envío de geometrías reales** | **PENDIENTE** | Nada. Encargar un análisis responde `409`, el adaptador no abre ninguna conexión y no hay ninguna clave registrada |

El sistema no deja que A se deslice hacia B: son estados distintos en la base, con restricciones distintas, y
**además** hace falta el interruptor `SATELLITE_LIVE_CALLS`. Tener el adaptador, estar seleccionado para desarrollo o
tener una credencial guardada **no** habilitan nada: lo comprueban pruebas específicas.

## Lo que falta para una primera prueba real (parte B)

| # | Requisito | Quién | Comprobable cómo |
| --- | --- | --- | --- |
| 1 | **Autorización para que geometrías de productores salgan hacia un tercero** y su base de tratamiento (**D-14**). Una parcela georreferenciada es dato del productor | Responsable de datos / legal | Decisión registrada; sin ella no se marca `SELECTED` |
| 2 | **Aceptación de los términos vigentes** del servicio alojado, leídos en su versión actual (no en el resumen de este documento) | Responsable que corresponda | Referencia de la decisión en `decision_reference` |
| 3 | **Clave de API**: obtenerla por registro, decidir **titularidad** (por organización o de plataforma) y custodia, y qué ocurre al revocarla | Producto / seguridad | La clave se guarda cifrada por organización; nunca se devuelve por la API |
| 4 | Marcar `WHISP` como **`SELECTED`** con responsable (`selected_by`) y referencia de la decisión | Tech lead / producto | La restricción de esquema rechaza `SELECTED` sin responsable |
| 5 | Encender **`SATELLITE_LIVE_CALLS=enabled`** en el entorno donde se hará la prueba | Operación | Sin él, `LIVE_CALLS_DISABLED` |
| 6 | Elegir **con qué parcela** se hace la primera prueba y con qué consentimiento | Producto / operación | — |

Y dos cosas que **no** se desbloquean con la parte B: que una regla de riesgo use el resultado (**D-07**) y que el
resultado se vincule como evidencia (**D-42**).

## D-09: el marco de decisión (dos aprobaciones distintas, ninguna supuesta)

La licencia del **código** de Whisp (MIT) **no es** aceptación de los **términos del servicio alojado** ni autorización
para enviarle geometrías. Son tres cosas separadas y aquí se separan también las aprobaciones:

| Aprobación | Qué habilita | Qué NO habilita | Quién decide |
| --- | --- | --- | --- |
| **A. Seleccionar un adaptador para desarrollo** | Escribir e integrar el adaptador contra el contrato publicado del proveedor; probarlo con servidores controlados | Ninguna llamada al servicio del proveedor; ninguna geometría fuera del equipo | Tech lead / producto |
| **B. Autorizar el envío de geometrías reales** | Registrar la credencial y llamar al servicio con parcelas reales | Cualquier conclusión regulatoria; sigue haciendo falta D-07 para que una regla use el resultado | Responsable de datos + producto/legal |

**A no implica B.** El sistema lo refleja: un proveedor queda `SELECTED` con su decisión registrada, pero sin
credencial no se llama a nadie, y la credencial se registra por organización en un paso aparte.

### Resumen para la decisión (datos de la documentación oficial consultada el 2026-10-14; no verificados con el proveedor)

| | |
| --- | --- |
| **Proveedor recomendado** | **Whisp** (Open Foris / FAO · Forest Data Partnership) como primer adaptador; GFW como segundo (la sustituibilidad es el criterio de RF-28); JRC GFC2020 como capa de referencia, no como proveedor por parcela |
| **Modalidad de uso** | Servicio **alojado por el proveedor**, API REST asíncrona: `POST /api/submit/geojson` → `GET /api/status/{token}` → descarga. Encaja con S1 §54 (la petición HTTP no espera el análisis). Alternativa a evaluar aparte: ejecutar el **paquete abierto** por cuenta propia, que cambia el perfil de datos (no saldría ninguna geometría) y el de coste (infraestructura propia) |
| **Términos del servicio y datos** | Pendientes de lectura y aceptación formal por el responsable. Lo publicado: geometría y parámetros técnicos; sin identificadores de usuario; almacenamiento temporal durante el análisis con borrado declarado en minutos; metadatos de petición con IP anonimizada a los 90 días. **No verificado por nosotros**; la infraestructura subyacente declarada incluye un tercero (Google Earth Engine) |
| **Coste o cuota verificable** | Publicado como gratuito y de código abierto (MIT). Cuotas publicadas: 5000 geometrías por trabajo asíncrono (250 síncrono), 30 peticiones/60 s por clave, 2 trabajos simultáneos, 600 s de plazo asíncrono (90 s síncrono). **Sin cotización ni acuerdo de nivel de servicio**: no hay compromiso contractual que invocar si cambia |
| **Credenciales necesarias** | Una clave de API por cabecera `x-api-key`, obtenida mediante registro. Falta decidir **titularidad y custodia**: ¿una clave por organización o una de plataforma? El sistema ya soporta clave **por organización**, cifrada y nunca devuelta por la API |
| **Datos que saldrían del equipo** | La **geometría exacta** de parcelas de productores (polígono o punto, WGS84) y los parámetros del análisis. **Nada más**: ni identidad del productor, ni códigos internos, ni nombres. La clave de API viaja solo a los hosts de la lista blanca |
| **Qué habría que registrar al aprobar** | `satellite_providers.selection_status = 'SELECTED'`, el responsable (`selected_by`) y la **referencia de la decisión** (`decision_reference`). La restricción de esquema impide «activar» un proveedor sin esos dos datos |

### Condiciones previas a B (envío de geometrías reales)

1. **Autorización para que las geometrías de productores salgan hacia un tercero** y su base de tratamiento (**D-14**:
   retención y base del tratamiento). Una parcela georreferenciada es dato del productor, no solo del sistema.
2. **Aceptación de los términos vigentes** del servicio alojado por el responsable que corresponda, leídos en su
   versión actual, no en el resumen de este documento.
3. **Titularidad y custodia de la clave**, y qué pasa al revocarla.
4. **Significado operativo de cada indicador** antes de que ninguna regla lo use: eso es **D-07**, no esta decisión.
   Hasta entonces el resultado es consultable y trazable, pero no alimenta ninguna conclusión.

Mientras A y B no estén aprobadas: **no se contrata, no se registra clave y no sale ninguna coordenada.**

## Alcance implementable sin D-09 (lo que entra en esta entrega)

1. Registro de proveedores con los tres candidatos documentados en estado `PROPOSED` y la fixture en `TEST_ONLY`;
   ninguno seleccionado.
2. Persistencia: `satellite_providers`, `satellite_jobs`, `satellite_results` (append-only), `satellite_credentials`
   (cifradas), con las restricciones de honestidad escritas en el esquema.
3. Puerto `SatelliteProvider` y adapter de fixture **sintética rotulada**, utilizable solo con el interruptor de
   desarrollo/prueba.
4. Trabajo asíncrono: la petición HTTP no espera al análisis (S1 §54); un corredor en el worker reclama trabajos con
   arrendamiento, reintento y desenlace explícito.
5. Defensa de salida (lista blanca, anti-SSRF con comprobación de DNS, sin redirecciones, plazo, tamaño, redacción).
6. API con sus permisos, auditoría y eventos; pantalla de parcela con el estado del análisis.
7. Pruebas: unitarias de la defensa de salida y del mapeo de desenlaces; de integración para autorización, aislamiento
   entre organizaciones, append-only y los desenlaces de QA-15 con fixture.

**Fuera de alcance por decisión ajena:** selección y contratación de proveedor (D-09), evaluabilidad de la regla de
riesgo (D-07 + catálogo aprobado), vínculo resultado→evidencia (D-37), perfil de destino geoespacial (D-05).

---

## Revisión de fuentes oficiales para D-09.B (2026-10-21)

**Propósito:** poner delante de quien decida la parte B (envío de geometrías reales) la documentación pública oficial **vigente a esta fecha**, separando lo que **dice la fuente** de lo que **no dice**. **No se contrató, no se creó cuenta, no se obtuvo clave y no se envió ninguna geometría ni dato personal.** `SATELLITE_LIVE_CALLS` permanece `disabled`; `WHISP` sigue `SELECTED_FOR_DEVELOPMENT` y sin credencial. Copias, URLs y huellas en `docs/sources/satelite-2026-10-21/` (`MANIFIESTO.md`).
Este apartado **actualiza** la «Propuesta de proveedor para D-09» de arriba (consulta del 2026-10-14) sin borrarla; donde difieren, manda lo fechado aquí.

### A. Qué cambió o se precisó frente a la consulta del 2026-10-14/15
| Tema | Antes (resumen del 2026-10-14) | Ahora (fuente leída el 2026-10-21) |
| --- | --- | --- |
| Contrato de la API | OpenAPI 2.3.0 | **Sin cambio**: OpenAPI 3.1.0, versión **2.3.0**; las rutas son las mismas |
| Datos personales | «sin identificadores de usuario» | Los **Términos** añaden: «Users must refrain from submitting any personally identifiable information including sensitive personal data» |
| Datos que llegan a Google Earth Engine | Geometría exacta | **Los Términos** dicen que a GEE solo llega «approximated geographic information» con datos de enmascaramiento; **las FAQ** dicen que a GEE llegan «geometry coordinates and technical parameters». **La fuente se contradice a sí misma**: no se puede afirmar cuál es |
| Almacenamiento | Temporal, ~10 min | Términos: «FAO does not store or retain user-submitted geo-data» y el procesamiento ocurre en servidores «in Europe»; FAQ: geometrías en el sistema de archivos del servidor «for the duration of the analysis», borrado típico en ~10 min |
| Condiciones del servicio | No leídas | **Modificables por FAO «without prior notice»**; FAO puede «modify, temporarily suspend or permanently terminate» el servicio «with or without prior notice»; información «as is», sin garantía de exactitud ni de vigencia; **sin acuerdo de nivel de servicio**; «Privileges and Immunities»: «The operation and management of this application are not subject to any national or regional legal system» |
| Versiones | — | La aplicación muestra **v2.3.0** y la biblioteca de análisis **«v3.0.0a17»** (una *alfa*); qué significa para los resultados **no está documentado** en lo leído |

### B. Whisp (Open Foris / FAO · Forest Data Partnership) — servicio y capacidades
- **Qué ofrece:** API REST que recibe geometrías (GeoJSON, WKT o GeoIDs) y devuelve «forest, land-use, and deforestation-risk analysis» de la biblioteca `openforis-whisp`, «backed by Google Earth Engine» (OpenAPI `info`). Rutas: `/api/config`, `/api/submit/{geojson|wkt|geo-ids}`, `/api/status/{token}` (+ `/cancel`, `/stream`), `/api/generate-geojson/{token}`, `/api/download-csv/{token}`, `/api/health`. Autenticación por cabecera `x-api-key`; «Register for free to get an API key».
- **Límites publicados (FAQ, «defaults … subject to change»):** hasta 5 000 geometrías por solicitud asíncrona y 250 por síncrona; 30 solicitudes por 60 s por clave; 2 trabajos simultáneos; plazos de 600 s (asíncrono) y 90 s (síncrono). *(La FAQ imprime «600 seconds for synchronous requests» en la primera línea: es una errata evidente de la fuente; se toma 600 s asíncrono por coherencia con la sección de límites; el valor autoritativo es `GET /api/config`.)*
- **Qué NO es:** «there is no certification involved»; «Compliance with the EUDR falls solely within the responsibility of competent authorities». Whisp no certifica ni garantiza cumplimiento.

### C. Datos que saldrían de Terra Link (según el adaptador implementado, no según el proveedor)
El adaptador envía **una geometría por trabajo**: `{ "type":"FeatureCollection", "features":[{ "type":"Feature", "properties":{}, "geometry": <geometría de la parcela> }], "analysisOptions":{ "async": false } }` con la cabecera `x-api-key`. **No envía** identidad del productor, códigos internos, nombres ni propiedades. Salen además, inevitablemente, la **IP del servidor de Terra Link** y la clave (que el proveedor registra como metadato de la solicitud; la FAQ dice que las IP se anonimizan tras un período configurable, por defecto 90 días).
**Decisión de fondo para el responsable de datos:** una geometría de parcela vinculada a un productor puede ser **dato personal** si permite identificarlo (el Reglamento de Ejecución 2024/3084, Art. 12(2)(d), trata la geolocalización como categoría de dato personal «where natural persons can be identified»). Los Términos de Whisp **prohíben enviar datos personales**. Si una geometría real es o no «datos personales» para este fin **no lo decide este documento**: lo determina quien tenga competencia en protección de datos (D-14).

### D. Cobertura, fechas y significado de los indicadores (solo lo que la fuente dice)
- **Corte temporal:** fin de 2020 (31-12-2020) como referencia de EUDR; las preguntas que contesta: ¿había cobertura arbórea en 2020?, ¿cultivos u otros usos agrícolas en 2020?, ¿perturbaciones hasta el 31-12-2020?, ¿desde el 01-01-2021?, y bosques primarios, regenerados y plantados en 2020.
- **Umbrales por defecto:** una pregunta se contesta «sí» cuando algún conjunto de datos relevante cubre más de un porcentaje de la parcela: **10 %** para todos los indicadores excepto cultivos en 2020 y perturbaciones anteriores a 2020, donde es **50 %**.
- **Resolución:** todas las capas se muestrean a **10 m**; la FAQ dice que las diferencias frente a la resolución nativa son «typically negligible (<1 %)».
- **Árboles de decisión de riesgo:** columnas `Risk_PCrop` (cultivos perennes, el caso del cacao), `Risk_ACrop`, `Risk_Timber`. Para cultivos perennes: **bajo** si no hay cobertura arbórea a fines de 2020, o si un conjunto de datos de cultivo detecta uso agrícola a fines de 2020, o (solo PCrop) si una perturbación anterior sugiere plantación previa al corte; **alto** = «evidence of tree loss on the plot after end-2020»; **«more info needed»** = lo que queda cuando nada de lo anterior se cumple: «a request for evidence, not a rejection».
- **Datasets de cacao citados en `layers_description.md`:** `Cocoa_FDaP` (modelo `model_2025b`, filtrado a 2020), `Cocoa_ETH` (umbral >65 %) y `Cocoa_bnetd` (solo Côte d'Ivoire). **Cuál se usa en la configuración por defecto para Ecuador no está dicho en lo leído.**
- **Cambios en el tiempo:** «Results may change as underlying datasets are updated or improved.» La documentación de apoyo advierte que los conjuntos nombrados en los diagramas «may not all be reflected in the current codebase».
- **Lo que la respuesta NO declara** (y Terra Link no inventa; ver `P0-028-WHISP-CONTRATO.md`): fecha del análisis, resolución, confianza, versión de cada dataset; ni un campo de cobertura. Un `200` no equivale a análisis completo: `whisp_processing_metadata` puede listar datasets no disponibles.
- **Significado operativo en Terra Link:** ninguno decidido. Qué hace una regla con estos indicadores es **D-07**, y que el resultado sea evidencia es **D-42**. Hasta entonces, consultable y trazable, **sin alimentar conclusiones**.

### E. Términos, licencia y tratamiento de datos
| Punto | Lo que dice la fuente | Pendiente de decisión humana |
| --- | --- | --- |
| Licencia | **MIT** para el software; la FAQ dice que, en general, «your organization does not need a formal agreement with the FAO to integrate Whisp» y que, si una política interna exige un documento formal, hay que pedirlo al equipo | MIT cubre el **código**; **no** sustituye la aceptación de los **Términos del servicio alojado** |
| Titularidad de los datos enviados | «Users retain ownership»; quien envía es «solely responsible for ensuring they have the legal rights to upload and process such data» | Que la organización/productor **tenga** esos derechos para esta finalidad |
| Datos personales | Prohibido enviarlos | Si una geometría de parcela lo es (ver C) |
| Procesamiento por terceros | Google Earth Engine (nube de terceros); datos «may be temporarily cached» | Aceptar la transferencia a un tercero y su base de tratamiento (D-14) |
| Retención | Términos: FAO no almacena ni retiene; FAQ: borrado típico ~10 min; metadatos de solicitud con IP anonimizada a los 90 días | **No verificado** por Terra Link |
| Cambios y continuidad | Términos modificables **sin aviso previo**; servicio suspendible o terminable en cualquier momento; sin SLA | Qué hace Terra Link si el servicio cambia o desaparece (la sustituibilidad de proveedores ya existe) |
| Responsabilidad y ley aplicable | «as is»; sin garantía; FAO sin responsabilidad; **privilegios e inmunidades** (el servicio no queda sujeto a un sistema legal nacional) | Valoración jurídica del riesgo de contratar un servicio sin SLA ni foro nacional |
| Identidad del titular de la cuenta | La clave se obtiene registrándose con una cuenta de identidad de FAO | Quién registra (una persona concreta queda como titular); qué ocurre si esa persona se va |

### F. Costes publicados y condiciones desconocidas
- **Publicado:** gratuito y de código abierto (FAQ); **ninguna tarifa, cotización ni acuerdo de nivel de servicio** aparece en las fuentes leídas.
- **Desconocido, y no se supone:** costes futuros; garantías de disponibilidad; condiciones de uso comercial intensivo más allá de «for very large datasets processed on a regular basis, we recommend reaching out to the Whisp team»; si habrá límites distintos para Terra Link.

### G. Titularidad y custodia de credenciales
- **Mecanismo existente:** clave **por organización**, cifrada con el mecanismo del proyecto, nunca devuelta por la API, enviada solo a hosts de la lista blanca.
- **A decidir:** (a) **una clave por organización** (cada una responde por su uso; N registros FAO) o (b) **una clave de plataforma** (un solo titular, pero tráfico mezclado y un único punto de revocación); (c) quién la registra y con qué cuenta; (d) rotación y revocación; (e) quién custodia la identidad FAO asociada.

### H. Aceptación técnica requerida para activarlo (antes de cualquier geometría real)
Orden propuesto, cada paso con su evidencia; ninguno está hecho:
1. **Contrato**: reconfirmar la versión de la especificación en el momento (hoy 2.3.0) y que el adaptador coincide; si cambió, corregir el adaptador y la referencia fechada, no el documento.
2. **Ensayo con geometría sintética** (`P0-028-ENSAYO-EXTERNO-PROPUESTA.md`, **no ejecutado**): correspondencia de respuestas, `x-api-key`, TLS con la defensa de salida puesta, límites reales frente a `/api/config`.
3. **Cobertura parcial**: que `unavailable_datasets`/`risk_inputs_unavailable` queden guardados como cobertura `PARTIAL`; el caso sin incidencias queda `UNKNOWN`, nunca `COVERED`.
4. **Interruptor y fallo cerrado**: `SATELLITE_LIVE_CALLS=enabled` solo mientras dure la prueba; apagarlo y verificar el rechazo `LIVE_CALLS_DISABLED`.
5. **Revocación y rotación de la clave** probadas.
6. **Ninguna geometría en registros** (el proveedor dice que no registra geometrías; Terra Link tampoco debe).
7. **Reversibilidad**: marcar `SELECTED` exige responsable y referencia de decisión; deshacerlo debe dejar el sistema sin llamadas.
Solo después, y con D-14 resuelta, se elige **con qué parcela real** y con qué consentimiento.

### I. Alternativas documentadas (sin cambio de recomendación existente)
| | Global Forest Watch / Global Nature Watch Pro (WRI) | EU Forest Observatory — GFC 2020 (JRC) |
| --- | --- | --- |
| Qué se pudo leer | **Términos de servicio** (el sitio redirige ahora a `globalnaturewatch.org`) | Página «Global forest cover 2020 — Data Access» |
| Lo que dicen | Cuenta obligatoria; claves de API por cuenta y responsabilidad del titular; WRI puede **rechazar** registros y **cancelar o suspender sin aviso**; la cuenta Pro exige representar a una organización «actively involved in commodity supply chains and/or their financing» con correo válido; el contenido enviado concede a WRI una licencia no exclusiva, mundial, transferible y sublicenciable (el de Forest Watcher/Pro se declara confidencial); atribución obligatoria de las APIs; «as is», responsabilidad limitada, ley de Delaware y arbitraje | Mapa global de cobertura forestal 2020 armonizado, creado con reglas que excluyen las áreas que no son bosque según la definición de FAO-FRA y EUDR; la **versión 4** tendrá informe técnico «expected to be released by December 2026»; «Known issues: Soon available…»; «The GFC 2020 map may be revised» |
| Lo que **no** se pudo leer | La **documentación de la API** (ReDoc con JavaScript no renderizado): cuotas, precios, condiciones de uso por parcela | El portal de descarga (aplicación JavaScript) |
| Consecuencia | **No se afirma** coste, cuota ni forma de envío de una parcela | Sigue siendo **capa de referencia**, no proveedor por parcela |

### J. Decisiones concretas
**Las resuelve el propietario del producto:** (1) ¿se autoriza preparar el **ensayo con geometría sintética** (paso H.2) con una clave de prueba, sin geometrías reales? (2) titularidad y custodia de la clave (G); (3) conservar Whisp como primer adaptador o reabrir la elección; (4) qué responsable acepta los Términos en nombre de la organización.
**Las resuelve un revisor competente (datos/jurídico):** (5) si una geometría de parcela es dato personal para este fin y su base de tratamiento (D-14); (6) si es aceptable contratar un servicio sin SLA, con términos modificables sin aviso, procesamiento por un tercero y privilegios e inmunidades; (7) la contradicción de la fuente sobre qué llega a Google Earth Engine.

### K. Integración con el desarrollo
| | |
| --- | --- |
| **Implementación existente** | Adaptador de Whisp contra el contrato 2.3.0; registro de proveedores (`WHISP` `SELECTED_FOR_DEVELOPMENT`, `GFW` y `EU_FOREST_OBSERVATORY` `PROPOSED`, `FIXTURE_SYNTHETIC` `TEST_ONLY`); credencial por organización cifrada; defensa de salida (SSRF); interruptor `SATELLITE_LIVE_CALLS` (hoy `disabled`); resultados con cobertura/procedencia; 10 trabajos de ensayo; 0 credenciales |
| **Implementación original pendiente** | Pasar de «fixture/ensayo» a servicio real; la regla `SATELLITE_COVERAGE_UNKNOWN` depende de D-09.B |
| **Puede completarse sin resolver la decisión** | **Nada inequívoco**: todo lo restante es una llamada al tercero o una decisión de datos |
| **Condición externa exacta** | Autorización de datos (D-14) + aceptación de Términos + titularidad de la clave; y, para el ensayo sintético, aprobación explícita acotada |
