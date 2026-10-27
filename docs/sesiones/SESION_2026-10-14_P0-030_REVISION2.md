# Sesión 2026-10-14 — P0-030, revisiones 2 y 3: §97 completo, cinco estados, permisos cruzados y consistencia

Continuación de la sesión que entregó los 11 KPI de S1 §60. Esta revisión **no cierra** la historia: completa los
reportes por entidad de S1 §97, corrige dos afirmaciones del contrato anterior y deja escrito, criterio a criterio, qué
está demostrado, qué falta y qué está bloqueado.

## Punto de partida

El levantamiento del entorno encontró algo que conviene registrar: los contenedores de aplicación servían **imágenes de
18 horas antes**, anteriores a `1cbfe14`. La pantalla de Reportes devolvía 404 aunque el código estaba en el repositorio
y sus pruebas pasaban. Se reconstruyeron las imágenes sin tocar volúmenes. La lección queda anotada: **una validación
aprobada acredita el commit, no lo que está corriendo**; son dos comprobaciones distintas.

Dos precisiones aceptadas sobre el informe anterior, por exactitud:

- Las marcas de las 37 migraciones acreditan la **continuidad del esquema**, no la integridad de todos los datos.
- El código de salida 255 de los contenedores es **indicio** de parada externa, no prueba de que Docker se reiniciara.

## Qué se corrigió del trabajo anterior

### 1. «No calculable» mezclaba cinco cosas distintas

El contrato de la revisión 1 metía bajo una sola etiqueta `NOT_CALCULABLE` situaciones que no son iguales. Ahora hay
cinco estados y cada indicador declara el suyo:

| Estado | Significa |
| --- | --- |
| `OK` | Calculado desde la base. **Un 0 es un cero observado** y se publica como número |
| `NO_DENOMINATOR` | El denominador es cero: el cociente no existe |
| `UNKNOWN` | El universo se conoce, pero la condición no ha sido evaluada en ningún sujeto |
| `CRITERION_UNDEFINED` | El criterio carece de definición aprobada (D-05) |
| `RESTRICTED` | El rol no tiene el permiso de ese dominio |

Además, cada indicador publica lo **observado**: los conteos que sí se pueden hacer aunque el valor principal no sea un
número. El caso que lo ilustra es `due_diligence_ready`: antes salía con una advertencia; ahora publica **0 como cero
observado** junto al desglose `READY / IN_PROGRESS / BLOCKED / sin instantánea`. Contar expedientes bloqueados es
perfectamente calculable; lo que no se deduce de ese conteo es conformidad. **Un resultado desfavorable no es motivo
para declarar algo incalculable.**

El riesgo distingue ahora dos situaciones que antes se confundían: sin sujetos evaluados es `NO_DENOMINATOR` (y el hecho
de que no haya evaluaciones es observado y se publica); con sujetos evaluados y ninguna severidad asignada es `UNKNOWN`.
En cuanto un solo lote quede clasificado, pasa a `OK` y entonces un 0 sí es un cero observado.

### 2. La cobertura histórica decía algo falso

La redacción anterior afirmaba que «toda serie anterior al 2026-10-13 está vacía por pérdida de almacenamiento». **La
pérdida fue del almacenamiento, no de las fechas operativas.** Un registro conservado o creado después puede declarar
una entrega de septiembre, y debe contar en septiembre.

Ahora se declara **cobertura histórica incompleta**, con la advertencia de que un período antiguo puede devolver menos
de lo ocurrido, y la regla explícita de que los registros disponibles se incluyen por su **fecha operativa declarada**,
aunque sea anterior a la pérdida. Lo que sí era correcto se conserva: **no se reconstruye ninguna cifra desde los
informes de QA**.

Probado: dos entregas con fecha de septiembre, registradas después de la pérdida, cuentan en un período de septiembre; y
el texto ya no afirma que lo anterior esté vacío.

### 3. D-05 no bloqueaba «la exportación GeoJSON», sino su perfil de destino

La exportación **técnica** no dependía de D-05 y ya era construible reutilizando P0-009. Lo que depende de esa decisión
es el **perfil de destino regulatorio**: qué geometría exige cada caso (punto o polígono según umbral), qué precisión y
redondeo admite el destino, qué propiedades espera y qué parcelas quedan calificadas. Eso se declara dentro del propio
archivo (`terra_link.regulatory_profile`), no se da por resuelto.

## Qué se añadió

- **Los seis reportes por entidad de S1 §97**: productor, parcela, lote, riesgo, trazabilidad y debida diligencia, con
  columnas, filas, totales y notas de lectura.
- **Exportación GeoJSON de colección**: `FeatureCollection` RFC 7946 con la geometría guardada, sin reproyectar ni
  recortar, con `plot:read_geometry` y auditoría.
- **Zona horaria y límites declarados**: límites de período inclusivos, `delivery_date` como fecha civil sin zona, y
  `as_of` en UTC. El sistema no asume ninguna zona y así se dice, en vez de inventar una.
- **Aviso de recálculo**: cada descarga recalcula desde la base y su marca de generación es la de la descarga, no la de
  la pantalla. Declarado en pantalla y en la cabecera del CSV.

### Reglas que gobiernan los reportes por entidad

- **Organización y alcance antes de agregar**, en la misma consulta que produce filas y totales.
- **Totales sobre el conjunto completo**, no sobre las filas mostradas: truncar la tabla a 500 filas no altera una cifra.
- **Un sujeto sin evaluar no se omite**: aparece rotulado como tal. Omitirlo escondería el desconocido.
- **Cantidades por unidad**; no existe un total único entre unidades distintas.
- **Faltar un permiso deniega el reporte entero**, no entrega una versión recortada: un total sobre una parte se leería
  como total de la organización.
- **Identidad bajo `producer:read_identity`**; coordenadas solo en el GeoJSON, bajo `plot:read_geometry`.

## Verificación

| | |
| --- | --- |
| Integración | `reports.int-spec.ts` (13) y `reports-entities.int-spec.ts` (11) — valores conocidos, períodos, desconocidos, aislamiento, permisos, consistencia pantalla/CSV y GeoJSON |
| Navegador | `e2e/tests/productos.spec.ts` — tres pruebas de P0-030: indicadores, reportes por entidad y permisos; teclado, 390 px y zoom 200 % (640 px CSS) |
| OpenAPI | regenerado y validado |
| Validación completa | **APROBADA** sobre `dd2e8da` — `validation-results/2026-10-14T14-51-46-796Z`: 51 suites, 405 unitarias + integración y 58 E2E (la de `75bb3a4` también aprobó, antes del arreglo visual del selector) |
| Corrida fallida conservada | `2026-10-14T14-17-05-917Z` sobre `dfeda36`: un fallo en E2E, de la prueba y no del producto — la aserción exigía «D-05» donde el estado correcto era `NO_DENOMINATOR` |

## Revisión 3: tres hallazgos de la revisión, los tres reales

1. **Fuga de conteos entre dominios.** El reporte de productores contaba parcelas y entregas exigiendo solo
   `producer:read`. Cada reporte exige ahora el permiso de **cada dominio del que publica datos**, con el motivo visible,
   y la regla se prueba **en memoria con permisos arbitrarios**, sin depender de cómo esté hoy el catálogo de roles.
2. **La severidad no dependía de P0-021 ni de P0-028**, como yo había escrito. Depende de **D-07** y del catálogo
   `risk_rule_sets` (`NOT_APPROVED`). Y el esquema lo refuerza: `risk_evaluations` lleva
   `CHECK (conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED')`. Lo descubrí porque la prueba del caso mixto
   intentó insertar una severidad y la base la rechazó: el caso mixto se prueba en memoria y la integración comprueba
   el candado.
3. **Comparar actividad no es reconstruir inventario.** Implementada la comparación entre períodos por fecha operativa;
   el saldo a una fecha sigue siendo capacidad distinta, sin contrato, y no se aproxima.

Además: paginación por cursor probada con 520 filas, exportación del conjunto completo hasta un tope declarado de
20 000 filas, y el **contrato de consistencia precisado**: la instantánea cubre una petición y una exportación, **no** la
navegación entre páginas. Se corrigieron los dos textos que prometían más de lo implementado.

| | |
| --- | --- |
| Validación final | **APROBADA** sobre `ebb8368` — `validation-results/2026-10-14T15-59-49-778Z`: 53 suites, 423 pruebas y 58 E2E |
| Validación previa | **APROBADA** sobre `feace4f` — `15-38-24-038Z`, antes de precisar los textos |

## Lo que sigue abierto

- **P0-030**: `plots_valid` (**D-05**, P0-010) y la distribución de riesgo (**D-07** y el catálogo `NOT_APPROVED`);
  el perfil de destino regulatorio del GeoJSON (**D-05**). Sin bloqueo externo no queda ningún requisito de la historia:
  los reportes programados y el saldo histórico **no los exige ninguna fuente** (comprobado por búsqueda literal) y el
  volumen de piloto corresponde a P0-031.
- **P0-029 y P0-017**: abiertas por el despacho.
- **Validación intermitente**: sin causa confirmada. H1 (latencia del disco USB) sigue sin demostrar.
- **Datos DEMO perdidos**: recuperación pendiente de decisión. No se recreó nada.

Estado por criterio, con su evidencia o su dependencia concreta: **`docs/decisiones/P0-030-CRITERIOS.md`**.
