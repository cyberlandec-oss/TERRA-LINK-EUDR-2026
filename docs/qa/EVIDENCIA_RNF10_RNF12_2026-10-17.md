# Evidencia — RNF-10 avisos operativos y RNF-12 retorno y recuperación (2026-10-17)

Tercera entrega bajo la organización por entregas funcionales completas.

| | |
| --- | --- |
| Candidato | **`9f27cbe`** |
| Validación | `2026-10-17T16-34-04-672Z` — **APROBADA** |
| Pruebas | **69 suites, 644** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `de7f996` | 68→**69** suites y 638→**644** pruebas: la suite de avisos |
| Migraciones | **48** (sin cambios: esta entrega no toca el esquema) |

## 1. Qué se reutilizó antes de añadir nada

El contrato exige no reducir un requisito a «hay logs» ni a «existe un script», y reutilizar lo existente. Se
partió de: `/health/live` y `/health/ready`, el **proxy TCP** de `redis-outage.int-spec.ts` que ya sabía cortar
y restaurar Redis sobre la misma API, el **outbox** con su estado `DEAD` y su reproceso idempotente, los
estados de análisis `CLEAN/INFECTED/PENDING`, la bitácora con `request_id` y el procedimiento de respaldo
QA-16. **Lo único nuevo es lo que faltaba**: los avisos y el ensayo de retorno.

## 2. Avisos (RNF-10)

`GET /operations/alerts`. Cinco avisos, cada uno con **condición comprobable, estado, lo observado, qué hacer y
recuperación reconocible**:

| Código | Condición | Clase |
| --- | --- | --- |
| `CORE_DEPENDENCY_DOWN` | Base, esquema al día o Redis no responden | **Indisponibilidad** |
| `SCHEMA_CODE_MISMATCH` | La migración aplicada no coincide con la que conoce el código, **en los dos sentidos** | **Indisponibilidad** |
| `DOCUMENT_ANALYSIS_UNAVAILABLE` | El escáner antimalware no responde | **Degradación** |
| `DOCUMENTS_PENDING_ANALYSIS` | Hay versiones sin análisis limpio | **Degradación** |
| `EVENT_DELIVERIES_DEAD` | Entregas del outbox agotadas que no se recuperan solas | **Degradación** |

**Nada inventado**: no hay objetivos p95, de disponibilidad ni umbrales, porque **TECH-001 sigue pendiente** y
sin él no habría nada que aprobar. Cada aviso se apoya en una condición ya definida en el producto.

**Sin secretos y sin permisos nuevos**: ruta pública como `/health` que, en ese momento, publicaba **recuentos agregados** (**corregido el 2026-10-17**: ver la actualización al final) —
ni identificadores, ni nombres, ni datos de ninguna organización. **No se amplió D-04** ni se añadió ningún
servicio de pago o envío a terceros.

**Una sola fuente de verdad**: `/health/ready` y los avisos comparten ahora `evaluarDependencias()`. Antes cada
uno evaluaba por su cuenta y podían contradecirse.

### 2.1 Degradación no es caída

El escáner caído **no** se presenta como fallo de toda la API ni como análisis limpio: responde **200**, los
documentos quedan **PENDIENTES** y el aviso dice qué hacer. Solo el núcleo da **503**.

### 2.2 Demostrado con fallos INDUCIDOS, no con logs

`operations-alerts.int-spec.ts` (**6**), en el arnés aislado —base `*_test` propia, Redis tras proxy TCP,
escáner gobernable—, **sin tocar desarrollo ni el otro proyecto Compose**:

| Fallo inducido | Detección | Recuperación |
| --- | --- | --- |
| Redis cortado | `503`, `CORE_DEPENDENCY_DOWN` FIRING, dice **qué** dependencia sin trazas ni cadenas de conexión | Restaurado el proxy, vuelve a `OK` **solo** |
| Escáner caído | `200` **degradado**, documentos pendientes, núcleo sigue `OK` | Restablecido, vuelve a `OK` **solo** |
| Entrega `DEAD` | FIRING con el recuento y qué hacer, sin identificadores de la organización | Reprocesada, el aviso se apaga |

## 3. Retorno y recuperación (RNF-12)

Documentado en `docs/20` §«Retorno y recuperación», **separando las tres cosas** que el requisito distingue:

1. **Retorno de la aplicación** — desplegar un SHA anterior. **Nunca uno vetado.**
2. **Compatibilidad con el esquema** — si esa versión entiende el esquema que hay.
3. **Restauración de datos y objetos** — traer el contenido desde un respaldo.

**`down`/`up` NO es recuperación de datos**, y queda escrito: reconstruye el esquema y regeneraría las
**referencias públicas con otros valores**, dejando sin resolver cualquier enlace ya emitido.

**Tras un retorno el esquema queda POR DELANTE del código.** Por eso el aviso se llama `SCHEMA_CODE_MISMATCH` y
detecta **los dos sentidos**; su acción explica qué hacer en cada uno.

### 3.1 Ensayo: `scripts/ensayo-retorno.mjs` — **12/12**

Corre en una base de ensayo propia que **crea y elimina** (`tl_ensayo_retorno`): **no toca la base de
desarrollo, sus volúmenes ni ningún recurso del otro proyecto Compose**. Los datos son los del respaldo,
declarados como ensayo.

| Comprobación | Resultado |
| --- | --- |
| Migraciones y tablas del respaldo | 48 y 110, las declaradas |
| **Referencias públicas EXACTAS** | 22 · **huella idéntica** (el conjunto, no solo el recuento) |
| Identidad cifrada con la clave activa | `k2=6`, `k1=0` |
| Historial y su protección append-only | 10 versiones · trigger `O` |
| Las claves acompañan al respaldo | `claves.env` presente (no se imprime) |
| Compatibilidad con el código actual | Coinciden (`0048`) |
| Un retorno a código más antiguo queda señalado | Volver a código que conozca hasta `0046` deja el esquema por delante: **detectado** |
| La versión actual no está vetada | `314ef81` admisible · 1 vetado registrado |
| **Fallo inducido**: se identifica | `pg_restore` termina con error, **no en silencio** |
| **Fallo inducido**: situación identificable | Base de ensayo con **0 tablas**: vacía y reconocible, no a medias |
| **Fallo inducido**: el reintento recupera | Huella de referencias **idéntica** |

### 3.2 Candidatos vetados como destino de retorno

`docs/qa/RETORNO_CANDIDATOS_VETADOS.txt`. El primero es **`8f54b71`**: validación **aprobada** con un defecto
de vinculación de sesión. **Una validación verde no acredita el contrato**, y por eso el ensayo comprueba la
lista antes de proponer un destino.

## 4. Verificación en el DESPLIEGUE

Servicios reconstruidos **una vez** sobre `9f27cbe`. Comprobado el **comportamiento**, no solo que responda:

| Comprobación | Resultado |
| --- | --- |
| En reposo | `status: ok`, los cinco avisos en `OK` |
| Sin secretos ni identificadores | confirmado sobre la respuesta real |
| Sin umbrales inventados | confirmado (`p95`, `slo`, `sla`, `uptime` ausentes) |
| **Fallo inducido real**: escáner detenido | **HTTP 200**, `status: degraded`, aviso FIRING con su acción, **núcleo `OK`** |
| `/health/ready` coincide | `degraded`, `document_analysis: UNAVAILABLE` |
| **Recuperación**: escáner restablecido | `status: ok`, aviso en `OK`, sin acción pendiente |

El escáner se detuvo y se restableció de forma **reversible y solo en este proyecto**; quedó `healthy` de nuevo
y los tres puertos responden 200.

## 5. Contraste de los criterios

| Requisito | Verificación literal | Estado |
| --- | --- | --- |
| **RNF-10** | «Request/job IDs, health/readiness y **alertas verificadas** sin secretos» | **Demostrado**: `request_id` en errores y en 542 filas de bitácora; identificadores de trabajos y entregas; `/health/live` y `/health/ready`; y los avisos verificados con fallos inducidos, sin secretos |
| **RNF-12** | «Entornos separados, secretos fuera de git, **rollback/migración revisados**» | **Demostrado**: bases `dev`/`*_test`/`*_e2e` separadas; `.env`, `CREDENCIALES*` y respaldos fuera de git (**0 secretos versionados**); **D-43** ejecutada el 2026-10-16 y el **ensayo de retorno 12/12** |

### Lo que NO se declara

**RNF-10 cubre lo que su verificación nombra, no toda la observabilidad de S1 §77**, que además pide *metrics*
y *tracing*. Eso **no está** y no se cuenta como hecho: el requisito con identificador es el que gobierna, y su
columna de verificación no los incluye. Si se quisieran, serían trabajo nuevo.

> **Actualización del 2026-10-17 (posterior a esta entrega).** Lo anterior describía bien el estado, pero se
> quedaba corto en una cosa: que ningún requisito recogiera *metrics* y *tracing* **no es razón para dejarlos
> fuera del catálogo**, porque la obligación está en la fuente. Se registró la omisión como **RNF-13** —junto
> con `/version`, que tampoco existía— y **se demostró** el mismo día. **RNF-10 no se reabrió**: su
> verificación sigue cumplida. Ver `docs/qa/EVIDENCIA_RNF13_OBSERVABILIDAD_2026-10-17.md`.
>
> En esa entrega se corrigió además una exposición de **esta misma**: `GET /operations/alerts` publicaba sin
> autenticar el recuento de documentos sin análisis limpio y de entregas `DEAD` **de todas las organizaciones**.
> Donde aquí se lee «ruta pública como `/health`, que publica **solo recuentos agregados**», hay que leer que
> **un agregado de un recurso protegido sigue siendo información de ese recurso**: la respuesta anónima quedó
> reducida a infraestructura y la actividad pasó a una ruta por organización, con sus permisos.

Tampoco se tocan `READY`, despacho, la conclusión `UNDETERMINED` ni el satélite, y **TECH-001 sigue pendiente**:
sin umbrales acordados no hay objetivo de rendimiento que aprobar (RNF-05).

## 6. Métricas

| Medida | Antes | Ahora |
| --- | ---: | ---: |
| Requisitos del catálogo completo | 28/59 = 47,5 % | **30/59 = 50,8 %** |
| Requisitos del alcance MVP | 27/43 = 62,8 % | **29/43 = 67,4 %** |
| Historias del MVP cerradas | 25/32 = 78,1 % | **25/32 = 78,1 %** (sin cambio) |

El cierre de historias **no se mueve**: RNF-10 y RNF-12 son transversales y cuelgan de **P0-031** y
**TECH-001**, que siguen abiertas.

## 7. Bloque regulatorio, preparado sin adoptar nada

`docs/22` §«El bloque regulatorio en una sola tabla» reúne **D-05.B, D-07.5, D-07.6 y P1-005** con pregunta,
propuesta existente, fuente y vigencia, qué falta, responsable y qué desbloquea. **Ninguna compuerta se tocó y
nada se adoptó.**

Una diferencia que conviene ver: las tres primeras se apoyan en la **copia fechada del Reglamento** que ya está
en el repositorio (`docs/sources/eudr-norma-2026-10-15/`, con sha256); **P1-005 no tiene fuente**, porque la
normativa ecuatoriana **no está incorporada**. Incorporarla fechada es trabajo posible y previo a decidir.

**D-09.B queda aparte**: ninguna llamada externa ni envío de geometrías está autorizado por esta entrega.

## 8. Medición de la tercera entrega agrupada

| | Primera | Segunda | **Tercera** |
| --- | --- | --- | --- |
| Validaciones completas | 2 (1 fallida por lint) | 2 (1 aprobada pero incumplidora) | **1** |
| Despliegues | 1 | 1 | **1** |
| Respaldos | 1 | 1 | **0** (sin cambio de esquema ni de datos) |
| Commits de resultados | 1 | 1 | **1** |

**Primera entrega sin repeticiones.** Las dos anteriores repitieron por causas distintas —no repasar lint, y un
defecto de contrato que las pruebas verdes no veían—; en esta, las comprobaciones dirigidas durante la
implementación bastaron. Tres entregas es todavía poco para afirmar una tendencia, y no se adelanta ningún
porcentaje de ahorro.
