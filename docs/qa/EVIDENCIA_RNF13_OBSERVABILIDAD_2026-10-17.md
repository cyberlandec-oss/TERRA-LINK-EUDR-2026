# Evidencia — Observabilidad segura y completa: RNF-13 y separación de avisos (2026-10-17)

Cuarta entrega bajo la organización por entregas funcionales completas.

| | |
| --- | --- |
| Candidato | **`83f7d7a`** |
| Validación | `2026-10-17T18-04-37` — **APROBADA** |
| Pruebas | **71 suites, 677** unitarias e integración · **72** E2E · 0 fallos |
| Respecto de `9f27cbe` | 69→**71** suites y 644→**677** pruebas |
| Migraciones | **48**, sin cambios: **esta entrega no toca el esquema** |
| Respaldo | **Ninguno**: sin migración, sin cambio criptográfico y sin intervención sobre datos |
| Ensayo de retorno | **No repetido**: nada de lo cambiado afecta al procedimiento de retorno |

## 1. Contraste de S1 §77: una omisión del catálogo, no una reapertura

S1 §77 «OBSERVABILIDAD» manda implementar cinco cosas y exponer tres endpoints. Contrastado uno a uno contra
los requisitos **con identificador**:

| Exigencia de S1 §77 | ¿Qué requisito la recoge? | Estado antes |
| --- | --- | --- |
| *structured logs* | RNF-10 («Request/job IDs») | Demostrado |
| *error monitoring* | RNF-10 | Demostrado |
| *health checks* · `/health` · `/ready` | RNF-10 | Demostrado |
| ***metrics*** | **Ninguno** | — |
| ***tracing*** | **Ninguno** | — |
| **`/version`** | **Ninguno** | — |

Se repasaron los **59** requisitos: **ninguno** recogía las tres últimas. **Una obligación de la fuente no
desaparece porque la columna de verificación de un requisito resumido la omita**, así que se registra como
**RNF-13**, con el mismo criterio por el que **RF-47** se dio de alta cuando S1 §49 exigía algo ausente.

**No se reabrió RNF-10.** Su verificación nombra lo que nombra y sigue demostrada; la carencia concreta —no
había métricas, ni trazas, ni `/version`— es **otra obligación**, y con requisito propio se puede decir sin
ambigüedad qué está hecho. El alta **bajó** los porcentajes publicados hasta demostrarla, y así se registró.

## 2. La exposición pública que había que corregir

El aviso del usuario era exacto. Comprobado **sobre el despliegue anterior**, sin autenticar:

```
ANTES — avisos en la respuesta ANÓNIMA: 5
   DOCUMENTS_PENDING_ANALYSIS     | observado: 0 versión(es) sin análisis limpio
   EVENT_DELIVERIES_DEAD          | observado: 0 entrega(s) DEAD
```

No había nombres, y aun así eran **actividad de documentos y de trabajos de todas las organizaciones a la
vez**, observable por cualquiera y a lo largo del tiempo. **Un agregado de un recurso protegido sigue siendo
información de ese recurso.**

### 2.1 Respuesta pública mínima e información operativa restringida

| | Antes | **Ahora** |
| --- | --- | --- |
| `GET /operations/alerts` (anónimo) | 5 avisos, **con recuentos** | **3 avisos, solo infraestructura**. No consulta **ninguna** tabla de negocio |
| Actividad operativa | En la ruta pública | `GET /api/v1/organizations/:orgId/operations/alerts`, **acotada a esa organización** |
| Quién la ve | Cualquiera | **El permiso que ya gobierna ese dato**: `document:read` y `events:reprocess` |
| Sin el permiso | — | **`RESTRICTED`**, sin valor ni recuento, declarando qué permiso falta |

**Se reutilizaron los mecanismos existentes**: `tenantContext()`, el catálogo RBAC y el patrón `RESTRICTED` que
los indicadores de P0-030 ya usaban. **No se amplió la elevación D-04**, que sigue habilitando una sola acción
de lectura redactada, y **no se creó ningún permiso de organización**.

La infraestructura **conserva su contrato público** porque es el mismo material que `/health/ready` ya
publicaba. `SCHEMA_CODE_MISMATCH` sigue mostrando la migración: también estaba ya en `/health/ready`.

### 2.2 Comprobado en el DESPLIEGUE

`e2e/review/observabilidad.mjs`, **23/23 APROBADO**, con inicios de sesión reales de cuatro roles:

| Comprobación | Resultado |
| --- | --- |
| Anónimo: solo los tres avisos de infraestructura | `scope=INFRASTRUCTURE` |
| Anónimo: **ningún** aviso de documentos ni de trabajos | ausentes los dos |
| Anónimo: **sin UUID, sin arroba, sin recuento de recursos, sin organización** | confirmado sobre la respuesta real |
| Sin sesión / cuenta de otra organización | **401** / **404** |
| **CONTROL**: esa misma cuenta en **su** organización | **200**, los dos reservados **sin recuento** |
| **CONTROL**: ORG_ADMIN ve la actividad de la suya | **200**, 2/2 con recuento |
| **Permiso a permiso**: AUDITOR | documentos **con valor** (control) · entregas **`RESTRICTED` sin número**, declarando `events:reprocess` |

En integración, `operations-alerts.int-spec.ts` (**10**) añade la prueba que más importa: con actividad real
creada en una organización —un documento sin análisis limpio y una entrega `DEAD`—, **la respuesta anónima es
idéntica antes y después**, y el **control autorizado** en la misma prueba demuestra que el dato **existía** y
se reservó de verdad.

## 3. Métricas y trazas (RNF-13)

### 3.1 Primero el inventario, y solo después lo que faltaba

| Ya existía | Se reutilizó |
| --- | --- |
| `X-Request-Id`: se acepta del cliente si tiene forma válida, y si no se genera | **Es el identificador de traza.** No se inventó ninguna clave |
| `request_id` en errores normalizados y en `audit_logs` | Desde una fila de bitácora o desde el error que vio una persona se llega a la traza |
| `describeForLog()`, que ya quitaba valores de los errores de PostgreSQL | Mismo criterio para la clase de error de un tramo |
| Correlación de trabajos (`worker_id`, `lease_token`, `attempt` en `event_delivery_attempts`) | Se conserva; no se duplicó |
| `evaluarDependencias()` | Alimenta también la métrica `dependency_up` |
| Enganche de consultas lentas en `createDb` | Ampliado a **todas** las consultas |

**Faltaba todo lo demás**: no había ninguna biblioteca de métricas ni de trazas, y no existía `/version`.

### 3.2 Qué se añadió, y por qué así

**Métricas: `prom-client` 15.1.3** (126 KB, en proceso). Acumula en memoria e imprime cuando alguien consulta
`/metrics`: **no contrata ningún servicio, no abre conexiones y no envía nada a terceros**.

**Trazas: implementación propia, no un SDK de exportación.** Un SDK con instrumentación automática captura por
omisión **el SQL completo con sus valores** y cuerpos de petición, y su utilidad está en **exportar a un
servicio externo**. Las dos cosas están prohibidas aquí. Instrumentar a mano con **lista blanca de atributos**
es más seguro y más demostrable que auditar lo que un agente automático decide capturar.

### 3.3 Lo que NUNCA sale, y cómo se comprueba

Todo lo que se etiqueta o se guarda pasa por `observability/sanitize.ts`, con **lista blanca**: lo que no está
nombrado no sale. `sanitize.spec.ts` (**14**) lo prueba con los casos reales del producto:

| Riesgo | Cómo se corta | Comprobado con |
| --- | --- | --- |
| Identificador en una etiqueta | Ruta reducida al **patrón** | `/organizations/<uuid>/lots/<uuid>` → `/api/v1/organizations/:id/lots/:id` |
| Referencia pública (24 hex, no es UUID) | Misma regla | `/public-references/a3f9…` → `:id` |
| Filtros con nombres o fechas | **La cadena de consulta se descarta entera** | `?email=ana@coop.ec&…` → se pierde |
| **Valores de SQL** | **Verbo y tabla, nada más** | `select … from "producers" where "blind_index" = $1` → `SELECT producers` |
| **Coordenadas** | Mismo recorte | `ST_GeomFromText('POINT(-80.164231 -0.848125)')` → `SELECT plot_versions` |
| Atributo nuevo por descuido | **Lista blanca** | `user.email`, `organization.id`, `db.statement`, `plot.coordinates`, `request.body` → **descartados** |
| Mensaje de error con datos | Solo la **clase** | `http_403`, `sqlstate_23505` |

### 3.4 Demostrado con consultas reales, no importando una biblioteca

`observability.int-spec.ts` (**29**) y el recorrido en despliegue:

| Comprobación | Resultado en el despliegue |
| --- | --- |
| `/metrics` sin sesión / con ORG_ADMIN | **401** / **403** (es permiso de **plataforma**) |
| **CONTROL**: plataforma | **200**, 365 líneas de exposición |
| **MEDICIÓN REAL**: 3 peticiones conocidas | la serie va de **0 → 3**, exactamente |
| Etiquetas | **267 series: 0 con UUID, 0 con correo**, ruta en patrón |
| Sin SQL, sin objetivos inventados | confirmado (`slo`, `sla`, `uptime`, `document_number_enc`, `blind_index` ausentes) |
| Trazas sin sesión / con ORG_ADMIN | **401** / **403** |
| **RECORRIDO REAL** desde el `request_id` | `GET /api/v1/organizations/:orgId/producers` **4 ms** → **2 tramos**: `SELECT memberships`, `SELECT producers` |
| Esa traza: identidad, SQL, coordenadas | **ninguna de las tres** |
| Traza inexistente | `found=false`, no inventa |
| `/version` público | `0.1.0`, esquema aplicado, **sin commit** |
| `build` con ORG_ADMIN / plataforma | **403** / **200** |

En integración se prueba además lo que el despliegue no puede: una petición que **escribe una cédula, un nombre
legal y crea un recurso** deja una traza donde **no aparece ninguno de los tres**, y una denegación se cuenta
como **4xx** sin confundirse con un acierto.

### 3.5 Degradación sigue sin ser caída

Comprobado otra vez tras el cambio, con el escáner **detenido de verdad** y restablecido:

| | Resultado |
| --- | --- |
| Público con el escáner caído | **HTTP 200**, `status: degraded`, núcleo `OK`, acción indicada |
| `/health/ready` | `degraded`, `document_analysis: UNAVAILABLE` — **la misma fuente, sin contradicción** |
| Tras restablecerlo | `status: ok` **solo**, sin intervención |

### 3.6 Límites declarados

- Las trazas viven en un **anillo acotado en memoria del proceso** (200): se pierden al reiniciar, el worker
  tiene el suyo y no se consulta por HTTP. **No es un backend de trazas**, y **nada se exporta**.
- `APP_COMMIT` no está definido en el despliegue local: `build` devuelve `commit: null` y así lo dice.
  Definirlo en la construcción queda **pendiente**.
- **Los logs siguen en el formato que RNF-10 verificó** (texto con `request_id=`), no en JSON. RNF-13 cubre
  *metrics*, *tracing* y `/version`; el formato del registro **no se toca** en esta entrega.
- **Medir no es cumplir un objetivo**: el histograma publica la **distribución observada**. **RNF-05 y RNF-06
  siguen pendientes** porque TECH-001 no ha acordado *budgets*, y **no se inventa ninguno**.

## 4. Fuentes ecuatorianas para P1-005, preparadas sin adoptar nada

`docs/sources/ecuador-2026-10-17/`, con el mismo criterio que la copia europea.

**El hallazgo que condiciona todo**: el **Registro Oficial** publica **ediciones cronológicas, no textos
consolidados**. No hay equivalente gratuito a los consolidados de EUR-Lex, de modo que **la vigencia no se
puede confirmar** con las fuentes obtenidas; reconstruirla exige aplicar reforma a reforma o recurrir a una
consolidación **comercial, que no es fuente oficial**.

| Obtenido | Clase | Límite declarado |
| --- | --- | --- |
| **Código Orgánico del Ambiente** (Asamblea Nacional; RO-S 983, 12-abr-2017) | **Texto normativo** | **Publicación original**, no consolidada. PDF **escaneado de 136 páginas, sin capa de texto**: no se ha leído ni verificado su contenido, y el OCR **no es fuente** |
| Índice normativo del MAG (7-dic-2023) | **Índice institucional, NO norma** | Orientación; no sustenta ninguna regla |

Ambos con **sha256, URL y fecha de consulta**. Se distinguen desde el principio **texto normativo**, **índice
institucional**, **guía técnica** y **propuesta de interpretación**: solo el primero puede sustentar una regla,
y solo si se confirma su vigencia.

**Siete cuerpos legales más quedan identificados y NO obtenidos** —entre ellos la **Ley de Tierras Rurales**,
que gobierna la legalidad de la parcela—, con su cita **declarada y sin verificar**. Incidencia registrada:
`www.ambiente.gob.ec` **no se pudo consultar** (fallo de saludo TLS).

**No se publicó ningún perfil jurídico, no se tocó ninguna compuerta, `UNDETERMINED` sigue igual y las llamadas
satelitales siguen deshabilitadas.** **P1-005 sigue abierta.**

## 5. Contraste de los criterios

| Requisito | Verificación literal | Estado |
| --- | --- | --- |
| **RNF-13** | «Métricas y trazas del servicio consultables y recorribles sobre un caso real, sin secretos ni identificadores de persona o recurso; `/version` publica la versión desplegada» | **Demostrado**: métricas medidas con peticiones reales (0 → 3), **267 series sin un solo identificador**, recorrido real de una traza hasta sus tramos de base, y `/version` sirviendo |
| **RNF-10** | «Request/job IDs, health/readiness y alertas verificadas sin secretos» | **Sigue demostrado**, y ahora **además** con la actividad separada de la respuesta pública |
| **RNF-01** | «Cero accesos cruzados en la matriz QA-02, incluidos objetos y relaciones» | **Sigue demostrado**: la ruta por organización no cruza, y la pública no publica nada de ninguna |

### Lo que NO se declara

**RNF-05 y RNF-06 siguen pendientes.** Tener métricas no es tener objetivos: TECH-001 no ha acordado ningún
*budget* y no se inventa. **P0-031 y TECH-001 siguen abiertas**, y por eso **el cierre de historias no se
mueve**. `DONE_LOCAL` no acredita producción ni conformidad EUDR.

## 6. Métricas

| Medida | Antes | Ahora |
| --- | ---: | ---: |
| Requisitos del catálogo completo | 30/59 = 50,8 % | **31/60 = 51,7 %** |
| Requisitos del alcance MVP | 29/43 = 67,4 % | **30/44 = 68,2 %** |
| Historias del MVP cerradas | 25/32 = 78,1 % | **25/32 = 78,1 %** (sin cambio) |

El denominador sube **porque el catálogo estaba incompleto**, no porque se haya ampliado el alcance. Si RNF-13
se hubiera dado de alta sin demostrarla, las cifras habrían **bajado** a 30/60 y 29/44; se registró así antes
de demostrarla.

## 7. Medición de la cuarta entrega agrupada

| | Primera | Segunda | Tercera | **Cuarta** |
| --- | --- | --- | --- | --- |
| Validaciones completas | 2 (1 fallida por lint) | 2 (1 aprobada pero incumplidora) | 1 | **1** |
| Despliegues | 1 | 1 | 1 | **1** |
| Respaldos | 1 | 1 | 0 | **0** |
| Commits de resultados | 1 | 1 | 1 | **1** |

**Segunda entrega seguida sin repeticiones.** Vale la pena anotar por qué: la comprobación dirigida de lint
**antes de congelar** encontró un import sin usar en una prueba nueva —**exactamente el fallo que costó una
validación completa en la primera entrega**—. El mismo defecto, atrapado en segundos en vez de en 17 minutos.
Cuatro entregas siguen siendo pocas para afirmar una tendencia.
