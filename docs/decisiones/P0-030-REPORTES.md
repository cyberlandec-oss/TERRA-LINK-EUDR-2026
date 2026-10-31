# P0-030 — Reportes e indicadores: contrato de cálculo (2026-10-14, revisión 2)

Fuentes: **S1 §60 «Dashboard técnico»** (lista literal de 11 KPI y la instrucción «no empezar por un dashboard bonito;
primero construir los indicadores desde queries reales»), **S1 §97 «Sprint 11 — Reporting»** (reportes de productor,
parcela, lote, riesgo, trazabilidad, DD y exportación GeoJSON), RF-30, docs/09, docs/17, QA-13/14 y `docs/UX_UI.md` §20.2.
Validación local; no acredita producción ni conformidad EUDR.

Estado por criterio, con lo demostrado, lo pendiente y lo bloqueado: **`docs/decisiones/P0-030-CRITERIOS.md`**.
Catálogo vigente: **`2026-10-15.1`** (añade `risk_critical`, extensión declarada de Terra Link).

## 1. Regla que gobierna esta historia

Un indicador solo existe si su **definición, unidad, fecha usada, numerador y denominador** están escritos y se calculan
desde la base. Cuando una capacidad no existe o su condición no es evaluable, el indicador **no se rebaja a cero**.

Pero tampoco todo lo que no es un número se mete en el mismo cajón. **Cinco situaciones distintas, cinco estados**:

| Estado | Significa | Ejemplo real hoy |
| --- | --- | --- |
| `OK` | Calculado desde la base. **Un 0 aquí es un cero observado** y se publica como tal | `due_diligence_ready` = 0 con 1 expediente BLOCKED |
| `NO_DENOMINATOR` | El denominador es cero: el cociente no existe. Ni 0 % ni 100 % | `traceability_completeness` sin lotes |
| `UNKNOWN` | El universo se conoce, pero la condición **no ha sido evaluada** en ningún sujeto | `risk_high` con lotes evaluados y todos `NOT_ASSESSED` |
| `CRITERION_UNDEFINED` | El criterio **carece de definición aprobada** y todavía no puede evaluarse | **Sin usuarios desde el 2026-10-15**: `plots_valid` salió de este estado al adoptarse D-05.A. Se conserva porque el caso puede volver a darse |
| `RESTRICTED` | El lector no tiene el permiso de ese dominio | Cualquiera, según el rol |

Dos consecuencias que se vigilan en las pruebas:

- **Ausencia de información no es cero, y cero no es un resultado favorable.**
- **Un resultado desfavorable no es motivo para declarar nada incalculable.** Si se puede contar, se cuenta: los
  expedientes BLOCKED, las parcelas sin evaluar, las entregas registradas sin fecha y los sujetos sin severidad se
  publican como **conteos observados** (campo `observed`), aunque el indicador principal sea desconocido.

## 2. Los 11 KPI de la fuente, uno a uno

`k` = tipo: **E** estado actual · **A** actividad en un período · **S** saldo a una fecha.

| KPI (S1 §60) | k | Definición | Unidad | Fecha usada | Denominador | Estado hoy |
| --- | --- | --- | --- | --- | --- | --- |
| `producers_total` | E | Productores no dados de baja (`deleted_at IS NULL`) del tenant | productores | — (estado) | — | `OK`; observa activos y dados de baja |
| `plots_total` | E | Parcelas no dadas de baja del tenant | parcelas | — | — | `OK` |
| `plots_valid` | E | Parcelas cuya **versión vigente** tiene dictamen `EUDR_GEO_V1 = MEETS_PROFILE` | parcelas | parcelas que **cumplen el perfil** | parcelas con versión vigente **evaluada con el perfil** | Desde el 2026-10-15 **se calcula**. Declara en `criterion` el perfil, su versión y las versiones realmente contadas (avisa si hay **mezcla**). Observa **cumple / no cumple / en revisión / no evaluable / sin evaluar**; las sin evaluar **no entran en el denominador**. Sin ninguna evaluación: `UNKNOWN` (el criterio existe, falta ejecutarlo), **no** `CRITERION_UNDEFINED`. Sin ninguna versión vigente: `NO_DENOMINATOR`. **No es conformidad**: eso depende de D-05.B |
| `deliveries_total` | A | Entregas **registradas** con `delivery_date` dentro del período (límites inclusivos) | entregas | `deliveries.delivery_date` (**no** `created_at`) | — | `OK`. Observa borradores y entregas registradas **sin fecha**, que quedan fuera de todo período y no se descartan en silencio |
| `lots_active` | E | Lotes en `OPEN` o `CLOSED_FOR_INPUT` | lotes | — | — | `OK`; observa el desglose por estado |
| `traceability_completeness` | E | Lotes con `origin_status = COMPLETE` ÷ lotes del tenant | % | — | lotes del tenant | `OK`, o `NO_DENOMINATOR` sin lotes. Mide **origen declarado completo**, no conformidad ni verificación |
| `risk_critical` | E | Lotes cuya **última** evaluación tiene `severity = CRITICAL` | lotes | — | lotes **con severidad asignada** | **Extensión declarada de Terra Link, NO está en la lista de S1 §60**: viaja con `catalog: "TERRA_LINK"` y la pantalla lo rotula como extensión. Se publica porque sin él los lotes **críticos** no aparecerían en ningún indicador. Mismos estados y mismo denominador que los tres de la fuente |
| `risk_high` | E | Lotes cuya **última** evaluación tiene `severity = HIGH` | lotes | — | lotes **con severidad asignada** | `NO_DENOMINATOR` sin evaluaciones; `UNKNOWN` si las hay y ninguna tiene severidad; `OK` en cuanto haya un lote clasificado, **sobre la base de los clasificados** y nunca como distribución del tenant. **No absorbe los `CRITICAL`**: cada severidad tiene su propio conteo. La dependencia es **D-07**: ver §6.bis |
| `risk_medium` | E | ídem con `MEDIUM` | lotes | — | lotes con severidad asignada | ídem |
| `risk_low` | E | ídem con `LOW` | lotes | — | lotes con severidad asignada | ídem |
| `evidence_completeness` | E | Afirmaciones `VERIFIED` ÷ afirmaciones del tenant | % | — | afirmaciones del tenant | `OK`, o `NO_DENOMINATOR` sin afirmaciones. Mide **verificación interna**, no validez jurídica |
| `due_diligence_ready` | E | Expedientes cuya **última** instantánea tiene `readiness = READY` | expedientes | — | expedientes del tenant | `OK`: hoy 0, que es un **cero observado**, con el desglose `READY/IN_PROGRESS/BLOCKED/sin instantánea`. READY es inalcanzable por dependencias abiertas, y el 0 **no** mide desempeño del equipo |

**Lo que no se mezcla**: peso declarado (`deliveries.quantity_declared`), recibido (`receptions.quantity_received`),
producido (`lots.output_quantity`), merma, existencia y reservado son magnitudes distintas. Ningún indicador las suma
entre sí. Ninguno de los 11 KPI de la fuente es de tipo **S** (saldo a una fecha): el ledger calcula saldos «ahora», y
reconstruirlos a una fecha arbitraria es una capacidad propia que **no se implementa aquí** en vez de aproximarla.

## 3. Períodos, fechas y zona horaria

- El período (`desde`/`hasta`) **solo se aplica a los indicadores de actividad**. En los de estado la respuesta lo
  declara como no aplicable en vez de filtrar en silencio por `created_at`.
- **Límites inclusivos**: una entrega declarada el 30-09 entra en un período que termina el 30-09. Probado con un
  período de un solo día.
- **`created_at` nunca sustituye a una fecha operativa.** Para entregas se usa `delivery_date`, que es la declarada.
- **Zona horaria**: Terra Link no asume ninguna. Las marcas con hora exigen zona explícita (`DATETIME_ZONE_REQUIRED`) y
  las fechas civiles declaradas —`delivery_date`— **no llevan zona ni se convierten**. El instante de cálculo (`as_of`)
  se publica en UTC con sufijo `Z` y no se traduce a ninguna zona local, porque el sistema no tiene una definida.
- **Denominador cero → `NO_DENOMINATOR`**, nunca 0 % ni 100 %.

## 4. Cobertura histórica: qué se declara y qué NO se afirma

Los volúmenes de Docker se recrearon vacíos el 2026-10-13 y se perdieron los registros creados por las revisiones del
2026-10-12 (`docs/qa/HALLAZGO_PERDIDA_DATOS_DEMO_2026-10-13.md`). Lo que se declara, en respuesta, pantalla y CSV:

- **La cobertura histórica es incompleta** por pérdida de almacenamiento. Un período antiguo puede devolver menos de lo
  que ocurrió, y ese resultado **no debe leerse como ausencia de actividad**.
- **Los registros disponibles se incluyen SIEMPRE por su fecha operativa declarada**, aunque sea anterior al 2026-10-13.
  Una entrega registrada después de la pérdida con fecha de septiembre **cuenta en septiembre**. Lo que falta son los
  registros perdidos, no un rango de fechas excluido.
- Las cifras de los informes de QA del 2026-10-12 son **evidencia histórica**, no registros operativos: **no se
  reconstruye ninguna cifra a partir de ellos**.

> Corrección respecto de la revisión 1, que afirmaba que «toda serie anterior al 2026-10-13 está vacía». Era incorrecto
> como afirmación general: la pérdida fue del almacenamiento, no de las fechas operativas.

## 5. Autorización

- `report:read` da acceso **a la pantalla**, no a los datos. Cada indicador exige además el permiso de **su dominio**:
  `producer:read`, `plot:read`, `delivery:read`, `lot:read`, `evidence:read`, `risk:read`, `dd:read`.
- Sin el permiso del dominio, el indicador sale como **`RESTRICTED`: sin valor, sin numerador, sin denominador, sin
  desglose observado y sin conteo**. Cada indicador es independiente y ninguno agrega sobre dominios que el lector no
  puede ver, de modo que **no se revelan recursos ocultos por diferencia**.
- En los **reportes por entidad**, un reporte exige el permiso de **CADA dominio del que publica datos, conteos o
  totales**, no solo el de la entidad que encabeza las filas: leer productores **no** autoriza a conocer cuántas parcelas
  o entregas tienen. Faltando uno, se deniega el reporte entero (403 que nombra el permiso que falta **y su motivo**,
  sin ninguna cifra del dominio restringido). Un total calculado sobre una parte se leería como total de la organización.

| Reporte | Permisos | Por qué el permiso adicional |
| --- | --- | --- |
| `producers` | `producer:read` + `plot:read` + `delivery:read` | cuenta parcelas y entregas de cada productor |
| `plots` | `plot:read` + `producer:read` | muestra el código del productor |
| `lots` | `lot:read` + `product:read` | muestra el código del producto |
| `risk` | `risk:read` + `lot:read` | el sujeto evaluado es un lote |
| `traceability` | `lot:read` + `delivery:read` + `plot:read` | cuenta entregas y parcelas por lote |
| `dd` | `dd:read` + `lot:read` | el expediente identifica su lote |
| GeoJSON | `report:export` + `plot:read` + `plot:read_geometry` + `producer:read` | coordenadas exactas y código de productor |

  La regla vive en `reports-catalog.ts`, un módulo **puro**, y se prueba en memoria con conjuntos de permisos
  arbitrarios (`reports-catalog.spec.ts`): si mañana un rol recibe `producer:read` sin `plot:read`, el reporte se sigue
  denegando sin depender de cómo esté hoy el catálogo de roles.
- El alcance por asignación (`*_assigned`) **no** habilita agregados ni reportes de organización: un técnico ve su
  trabajo, no cifras del tenant. El filtro de alcance se aplica igualmente **dentro de la misma consulta** que produce
  filas y totales, para que un cambio futuro de catálogo no abra un agregado por descuido.
- `report:export` es un permiso **separado** de `report:read`, y se revalida al descargar.
- **Identidad**: los nombres de productor exigen `producer:read_identity`; sin él el reporte usa solo el código. Documento,
  teléfono y dirección están cifrados y **nunca** aparecen en ningún reporte.
- **Coordenadas**: ningún reporte tabular las incluye. Solo la exportación GeoJSON, que exige `plot:read_geometry`.

## 6. Interpretación (lo que el reporte declara, por escrito)

- **Readiness no es conformidad.** `due_diligence_ready` cuenta preparación interna; `READY` y `EXPORTED` no son
  presentación de DDS.
- **Reserva no es despacho** (P0-029): ningún indicador ni reporte presenta reservas como salidas.
- **`INTEGRATED` del catálogo CTE** sigue significando que la operación y su evento existen, no que estén acreditados.
- Calidad, origen, hallazgos técnicos de GIS, revisión de riesgo y preparación DD son **dimensiones distintas** y no se
  combinan en una puntuación única.
- **`NOT_VALIDATED` significa SIN EVALUAR**, no «inválida». El reporte de parcelas lo rotula así en la celda.

## 6.bis Qué determina la severidad de riesgo

**No** es cerrar P0-021 ni P0-028. P0-021 está **implementada**, y verificar una mitigación entra en el resultado
**técnico** de su factor: no asigna severidad ni produce conclusión favorable. Lo que la determina es **D-07**, en
dos pasos que el motivo del indicador cita leyendo la base, nunca una lista de historias pendientes:

1. que exista un catálogo **publicado** globalmente — desde el 2026-10-15 lo hay: `1.0.0`, `APPROVED` —, y
2. que **esa organización lo haya adoptado** (D-07.1). **Publicar no es adoptar**: sin una adopción que la
   respalde, el `CHECK risk_evaluations_severity_backed` (migración `0042`) **impide escribir cualquier
   severidad**, por mucho que el catálogo esté aprobado globalmente.

Adoptado el catálogo, una evaluación todavía puede salir sin severidad: por **A.2** (ningún hallazgo en las reglas
evaluadas) o porque los hallazgos pertenecen a reglas **sin severidad declarada**. El motivo del indicador dice
cuál de las tres situaciones es.

La **conclusión regulatoria** es otra dimensión y sigue clavada: `CHECK risk_evaluations_conclusion_undetermined`
mientras D-07.5 y D-07.6 sigan pendientes. Clasificar hallazgos **no** concluye nada.

Cuando sí hay clasificación, el indicador declara que es **parcial**: de qué catálogo adoptado sale, que ese
catálogo puede no cubrir todas las categorías de riesgo y que no es una conclusión regulatoria. El reparto se
prueba en memoria (`reports-risk.spec.ts`) con conjuntos sintéticos —incluido el caso mixto y el reparto
`CRITICAL`/`HIGH`— y la integración lo comprueba contra la base, adoptando y retirando el catálogo `1.0.0`.

## 7. Reportes por entidad (S1 §97)

`GET /reports/entities` publica el catálogo con el permiso que exige cada reporte y el que le falta al rol.
`GET /reports/entities/{kind}` devuelve columnas, filas, **totales** y notas; `{kind}/export` el CSV equivalente.

| `kind` | Permisos | Qué muestra |
| --- | --- | --- |
| `producers` | `producer:read` | Parcelas, parcelas con geometría y entregas registradas del período, por productor |
| `plots` | `plot:read` | Ubicación (sin versión / solo superficie declarada / geometría registrada), método, validación y superficies |
| `lots` | `lot:read` | Estado, origen, entradas vigentes y cantidad **con su unidad** |
| `risk` | `risk:read` + `lot:read` | Última evaluación por lote; los lotes **sin evaluar aparecen como tales** |
| `traceability` | `lot:read` | Entradas con origen conocido y desconocido, entregas y parcelas declaradas, por lote |
| `dd` | `dd:read` | Última instantánea, revisiones y exportaciones, por expediente |

Reglas propias:

- **Organización y alcance se aplican antes de agregar**, en la misma consulta que produce filas y totales.
- **Paginación por cursor** sobre la clave natural de cada reporte (`producer_code`, `plot_code`, `lot_code`,
  `case_number`), única dentro del tenant: páginas estables, sin duplicados ni omisiones. Página por omisión 100, máximo
  500. Probado con 520 filas.
- Los **totales se calculan sobre el conjunto completo ya filtrado**, no sobre la página mostrada: avanzar o truncar la
  tabla no altera ninguna cifra.
- **Instantánea de lectura, con su alcance exacto** (ver §7.bis).
- **Un sujeto sin evaluar no se omite**: omitirlo escondería el desconocido y haría parecer completo lo que no lo está.
- **Las cantidades van por unidad.** No existe un total único entre unidades distintas.
- Cuando ningún sujeto está clasificado, el total correspondiente sale **`DESCONOCIDO`**, no 0.

## 7.bis Contrato de consistencia: qué se garantiza y qué no

| Situación | ¿Instantánea compartida? | Detalle |
| --- | --- | --- |
| Filas y totales de **una misma petición** | **Sí** | Una transacción `REPEATABLE READ` de solo lectura por petición |
| Todas las páginas de **una exportación** | **Sí** | La exportación recorre sus páginas dentro de esa misma transacción |
| Dos **peticiones distintas** (p. ej. avanzar de página) | **No** | Cada petición abre su propia instantánea: entre una página y la siguiente los datos pueden haber cambiado |
| Pantalla abierta y descarga posterior | **No** | La descarga recalcula; su marca `generado` es la del momento de descargar |

Reutilizar la misma función **no** da por sí sola una instantánea: lo que la da es la transacción. Y no se declara más
garantía de la implementada: no hay instantánea compartida entre peticiones, ni se simula con cursores de versión.

## 8. Exportación

CSV `TL_REPORT_CSV 0.1` (formato local propuesto; las fuentes no definen uno), reutilizando el patrón ya probado de
P0-025: cabecera de metadatos con organización, período, filtros, fecha de generación, totales y alcance; `sha256` del
cuerpo; registro en auditoría con el hash y los filtros; y **neutralización de fórmulas** (`=`, `+`, `-`, `@`, tabulador,
CR) mediante `csvCell`. **No hay enlaces públicos**: la descarga exige sesión, `report:export` y pertenencia al tenant.

**Instantánea frente a recálculo, declarado**: dentro de una misma petición, pantalla y archivo salen del mismo cálculo,
así que coinciden. Pero **cada descarga recalcula desde la base**: su marca `generado` es la del momento de la descarga,
no la de la pantalla que el usuario tenía abierta. Si los datos cambiaron entre una y otra, el archivo refleja los datos
nuevos. Esto se dice en la pantalla y en la cabecera `# recalculo` del CSV.

**La exportación cubre el conjunto completo**, no la página mostrada: recorre todas las páginas dentro de la misma
instantánea, **hasta un tope de 20 000 filas**. El tope se declara en tres sitios, no solo dentro del archivo: en la
respuesta (`export_limit` y `export_note`), en la pantalla junto al botón de descarga, y en el propio CSV, cuya cabecera
`# filas` dice «N de TOTAL (conjunto completo)» o «N de TOTAL (TRUNCADO en el tope de 20000…)». Los totales cubren el
conjunto completo aunque las filas se trunquen. El reporte de indicadores es un conjunto acotado y no se pagina. El formato es provisional y **no está
aprobado por ninguna autoridad**.

## 8.bis Comparación de actividad entre períodos

`GET /reports/indicators?from&to&compare_from&compare_to` devuelve, además, el mismo cálculo sobre un segundo período
para los indicadores de **ACTIVIDAD**, con su diferencia. Ambos períodos se calculan **en la misma instantánea**.

- Usa las **fechas operativas declaradas** (`delivery_date`), nunca `created_at`.
- Declara si los tramos son **equivalentes** (mismo número de días) en vez de corregirlo en silencio.
- Repite el aviso de **cobertura histórica incompleta**: un período antiguo puede quedar por debajo de lo ocurrido.
- Los indicadores de **estado no se comparan**: describen el momento actual y no tienen serie.
- **Comparar actividad NO es reconstruir existencias.** El saldo a una fecha es una capacidad distinta, sin contrato
  aprobado, y no se aproxima aquí.

## 9. Exportación GeoJSON (S1 §97)

`GET /reports/entities/plots/geojson` → `FeatureCollection` RFC 7946 (WGS84 longitud/latitud), un Feature por parcela
vigente **con geometría**. Exige `report:export` + `plot:read` + `plot:read_geometry`.

Reutiliza la capacidad técnica de **P0-009** (`exportVersion`, que ya exportaba una versión concreta): misma geometría
guardada, mismas propiedades, **sin reproyectar, recortar ni reparar**. Lo que añade es el alcance de organización, el
permiso de reporte y la declaración de lo que queda fuera.

- Las parcelas **sin geometría no se exportan y no se inventan**: una superficie declarada no es una ubicación. Su
  número se declara en el miembro ajeno `terra_link.counts` (RFC 7946 §6.1 admite miembros ajenos).
- `validation_status = NOT_VALIDATED` se explica como **sin evaluar**, no como inválida.
- **Exportación técnica ≠ perfil de destino regulatorio.** El archivo declara `regulatory_profile: { status: PENDING,
  depends_on: D-05 }` y qué es exactamente lo que depende de esa decisión (geometría exigida por caso, precisión y
  redondeo, propiedades esperadas y parcelas calificadas). Ver `docs/decisiones/P0-030-CRITERIOS.md` §4.
- Queda auditado con `sha256`, número de features y número de parcelas omitidas por no tener geometría.

## 10. Lo que esta historia todavía no cubre

**Reportes programados**: ninguna fuente los exige (comprobado en S1 §60, §97, RF-30, docs/09, docs/17 y UX_UI §20.2),
así que no se implementan; si se adoptaran, exigirían autorización vigente al ejecutar **y** al descargar.
**Saldo o existencias a una fecha pasada**: capacidad distinta, sin contrato, que no se aproxima.
**Volumen de piloto medido**: corresponde a P0-031.
El detalle, con la fuente exacta de cada uno y su clasificación —requisito, mejora o bloqueo externo—, está en
`docs/decisiones/P0-030-CRITERIOS.md` §3.bis. **Actualización 2026-10-15**: `plots_valid` ya no bloquea, se calcula contra el perfil `EUDR_GEO_V1`. La historia **sigue ABIERTA** por la distribución de riesgo
y por lo que el perfil NO decide: la conclusión regulatoria (D-05.B).
