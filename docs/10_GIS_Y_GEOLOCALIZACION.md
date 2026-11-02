# GIS y geolocalización

FUENTE: S1 §§13–16, 39–41, 72, 82–84; S3 histórico de parcelas y evidencia. PROPUESTA: validación separada y cobertura de precisión.

## Representaciones

PostGIS para geometría consultable e índice GiST. GeoJSON RFC 7946 con coordenadas `[longitud, latitud]` en WGS84; no guardar solo texto para consultas. Puntos y polígonos no son equivalentes. Un punto no permite calcular área del perímetro: área calculada null, área declarada separada.

Para superficie usar geodesia (`geography`) o proyección adecuada validada, expresada en hectáreas. No calcular ha directamente en grados. Precisión decimal de coordenadas no demuestra precisión del GPS. Evitar redondear muestras originales para producir un supuesto de mejor medición.

## Pipeline

1. Comprobar tipo y límites del payload, CRS de entrada y coordenadas válidas.
2. Normalizar explícitamente formato/CRS autorizado, preservando original y método; rechazar CRS desconocido.
3. Validar anillos cerrados, mínimo de vértices, intersecciones propias, vacíos y geometría válida.
4. Calcular área solo si posible; comparar declarada/capturada con tolerancia configurada.
5. Revisar ubicación, solapamiento y duplicados con capas/versiones registradas. Un solapamiento genera revisión, no prueba automática de fraude.
6. Aplicar regla de tipo requerido según área, producto y perfil jurídico aprobado.
7. Guardar resultado `VALID/WARNING/INVALID/REVIEW_REQUIRED`, motivos y rule_set_version.

Corrección automática de una geometría puede cambiar la parcela. Si se propone reparación, mostrar antes/después y obtener confirmación de quien tiene permiso; conservar versiones.

## Perfil de importación GeoJSON (P0-009, `GEOJSON_IMPORT_V1`, implementado)

Cuatro niveles distintos: **intercambio** (este perfil, RFC 7946), **estructura** (rechazo 422 si no se cumple), **validez geométrica técnica** (PostGIS `ST_IsValid`: autointersección, huecos fuera del exterior…) y **validación GIS** (P0-010, pendiente: toda versión queda `NOT_VALIDATED`).

| Aspecto | Regla |
| --- | --- |
| Tipos | Polygon y MultiPolygon (con huecos). Point, LineString, GeometryCollection… → `TYPE_NOT_SUPPORTED` |
| Envolventes | Geometría directa; Feature; FeatureCollection con **exactamente una** feature (advertencia). Vacía → `EMPTY_FEATURE_COLLECTION`; varias → `MULTIPLE_FEATURES` (un archivo = una parcela; no se importan varias en silencio) |
| Coordenadas | `[longitud, latitud]`, grados decimales WGS84. SRID 4326 en PostGIS no cambia ese orden. Rangos −180…180 / −90…90 |
| Dimensiones | Exactamente 2. Altitud u otras → `EXTRA_DIMENSIONS_NOT_SUPPORTED` (no se eliminan) |
| CRS heredado (`crs`, GeoJSON 2008) | CRS84 → aceptado con advertencia (no cambia nada). EPSG:4326 declarado (orden de ejes ambiguo) u otro CRS → `CRS_NOT_SUPPORTED`. Nunca se reproyecta |
| Anillos | ≥4 posiciones y cerrados (`RING_NOT_CLOSED`, sin cierre automático) |
| Ejes | Si todas las posiciones parecen `[lat, lon]` de Ecuador → advertencia `POSSIBLE_AXIS_SWAP`; no se intercambian |
| Ignorados con advertencia | `properties`, `id`, `bbox`: la parcela y la organización salen de la pantalla autorizada, nunca del archivo |
| Límites (configurables) | `GEOJSON_MAX_BYTES` 1 MiB, `GEOJSON_MAX_POSITIONS` 5000, `GEOJSON_MAX_DEPTH` 10, `GEOJSON_MAX_COMPONENTS` 50, `GEOJSON_MAX_RINGS` 50 |
| Validez técnica | Inválida → se muestra el motivo (sin coordenadas en notas/eventos/auditoría); confirmar exige «conservar para revisión» (D-26): sin superficie ni reparación |
| Decimales | Se informan como dato del archivo; no son precisión de medición |
| Original | Bytes intactos en almacenamiento privado S3 + SHA-256 calculado en el servidor (identidad de bytes, no autenticidad del origen) |
| Exportación | Feature RFC 7946 de una versión concreta (`ST_AsGeoJSON` con 17 dígitos: ida y vuelta exacta de los dobles); propiedades técnicas sin identidad personal; aviso «no es paquete EUDR ni declaración presentada». Distinta de la descarga del original |

Desde el 2026-10-15, «perfil destino», validación GIS y umbral de 4 ha están cubiertos por el perfil técnico `EUDR_GEO_V1` (D-05.A, abajo). Pendiente y **separado**: la aplicabilidad jurídica (**D-05.B**) y la aceptación por el **servicio real** del destino, nunca probada.

## Evaluación GIS técnica (P0-010, `TL_GIS_TECH` 1.0.1, implementada)

Evalúa una versión geométrica **sin modificarla** y guarda un registro inmutable (`gis_evaluations`). Reevaluar crea otro registro. Tres bloques que no se mezclan:

1. **Validez técnica** → estado `VALID` / `WARNING` / `INVALID` / `REVIEW_REQUIRED`, siempre con alcance técnico («VALID» no es conformidad EUDR).
2. **Calidad y cobertura de captura** → informativa: COMPLETE / PARTIAL / ABSENT (resumen de precisión) o NOT_AVAILABLE («Precisión de captura no disponible» para importadas o sin muestras; nunca se infiere de decimales). Sin umbrales (D-25).
3. **Perfil de destino / regulatorio** → esta evaluación técnica sigue diciendo «No evaluado» **a propósito**: desde el 2026-10-15 el perfil se evalúa con una regla propia y versionada aparte (`EUDR_GEO_V1`, abajo). Son dos dictámenes y pueden discrepar.

| Comprobación | Resultado posible | Nota |
| --- | --- | --- |
| GEOMETRY_PRESENT | PASS / FAIL (`GEOMETRY_MISSING` → REVIEW_REQUIRED) | Versión solo con superficie declarada |
| GEOMETRY_TYPE, SRID, COORDINATE_RANGE, NOT_EMPTY | PASS / FAIL | SRID 4326; rangos lon/lat |
| NOT_DEGENERATE | PASS / FAIL / NOT_APPLICABLE (punto) | Polígono sin superficie |
| TECHNICAL_VALIDITY | PASS / FAIL con código controlado (`SELF_INTERSECTION`, `HOLE_OUTSIDE_SHELL`…) | Ubicación del problema guardada aparte; solo con `plot:read_geometry` |
| AREA | PASS (ha geodésicas) / NOT_APPLICABLE (punto) / NOT_EXECUTED (no válida) | Sin área mínima |
| GEOMETRIC_EQUALITY | PASS / REVIEW / WARNING (comparaciones incompletas) | `ST_Equals`: igual aunque cambie el orden o inicio de vértices; se informa aparte si coincide el hash |
| OVERLAP | PASS (sin relación o solo contacto) / REVIEW / WARNING / NOT_EXECUTED (punto: fuera de V1) | Superficie compartida = DE-9IM `2********`; contacto por borde/vértice = TOUCH, no cuenta |

Estado: FAIL → INVALID; si no, REVIEW (igualdad/solape o sin geometría) → REVIEW_REQUIRED; si no, WARNING → WARNING; si no, VALID. Alcance de comparación: otras parcelas ACTIVAS de la organización, versión vigente, geometrías válidas; nunca las versiones históricas de la misma parcela. Una coincidencia no prueba ilegalidad ni autoriza fusionar parcelas.

Desactualización (sin tocar el registro): `GEOMETRY_CHANGED` (hay versión más nueva), `RULES_CHANGED` (otra versión de regla), `COMPARED_PLOTS_CHANGED` (cambió la huella del conjunto comparado).

Privacidad (corregida el 2026-10-10, doc 09: «no revelar counts o identidades ocultas»): (1) el alcance de comparación es el del evaluador: con `plot:read`, toda la organización (`ORGANIZATION`); con solo `_assigned`, únicamente sus parcelas asignadas (`EVALUATOR_ASSIGNED`), y queda registrado en el resultado; (2) un lector sin `plot:read` ve el bloque de comparación de una evaluación de organización como «Reservada» **siempre**, haya o no coincidencias, y el estado se calcula solo con las comprobaciones de la propia geometría (`view_scope: GEOMETRY_ONLY`); (3) no se devuelve ningún tipo ni cantidad de relaciones ocultas, ni la desactualización por cambios en parcelas que no puede ver. **Versionado (precisado el 2026-10-10):** la corrección cambia el *contenido calculado* de las evaluaciones de quien solo lee sus parcelas asignadas (se compara con otro conjunto), por lo que se publica `TL_GIS_TECH 1.0.1`. 1.0.0 = comparación siempre con toda la organización (registros anteriores, inmutables, que ahora se muestran desactualizados por `RULES_CHANGED`); 1.0.1 = conjunto comparado según el alcance del evaluador (`comparison_scope` y `scope_membership_id` guardados en cada registro para reproducirlo). Las comprobaciones geométricas son idénticas. D-30 sigue sin ratificar y no se añaden comprobaciones. PostGIS emite `NOTICE` con coordenadas (p. ej. `ST_IsValid`): las conexiones usan `client_min_messages=warning` y el código usa `ST_IsValidDetail`; los errores de base se registran solo con SQLSTATE. El servidor PostgreSQL local registra desde WARNING (`log_min_messages=warning`), así que los NOTICE no llegan a su registro; las sentencias usan parámetros y `log_parameter_max_length_on_error=0`, por lo que los valores no se registran. Riesgo residual: el registro del servidor sí guarda el **mensaje** de un ERROR de base de datos; la aplicación evita operaciones GEOS sobre geometrías inválidas y valida GeoJSON antes de PostGIS para no provocar errores con coordenadas. El acceso a ese registro debe restringirse en operación.

## Perfil técnico de destino (D-05.A, `EUDR_GEO_V1` 1.0.0, implementado el 2026-10-15)

**Dictamen aparte de `TL_GIS_TECH`**, con regla, tabla (`geo_profile_evaluations`, append-only) y versión propias.
Los dos se muestran juntos en la ficha de parcela porque **pueden discrepar**: un polígono con hueco es
técnicamente válido (OGC) y **no cumple el perfil**, porque el destino no procesa huecos.

`MEETS_PROFILE` significa **«bien formado para una versión documentada del destino»**. No significa conforme, ni
legal, ni aceptado: la aplicabilidad jurídica es **D-05.B** y sigue pendiente, y **nada se ha probado contra el
servicio real**.

**Fuente**, con sus identificadores separados —que no son intercambiables—: **servicio V3** · **documento
«Operator API Reference» v1.2** · página *GeoJSON File Description* del **17-08-2026**. Copias con `sha256` en
`docs/sources/eudr-is-2026-10-15/`; norma en `docs/sources/eudr-norma-2026-10-15/`.

### Umbral

| Superficie de referencia | Punto | Polígono |
| --- | --- | --- |
| `< 4 ha` | Admitido | Admitido |
| **`= 4 ha` exactas** | **Admitido**, con aviso de igualdad | Admitido |
| `> 4 ha` | **No cumple**: exige polígono | Admitido |
| `< 0,0001 ha` | No cumple | — |
| Punto **sin** superficie | **No evaluable y no exportable** | — |

Operador **estricto** (`> 4`), respaldado por las dos capas: el Art. 2(28) dice «more than four hectares» y el
destino levanta error solo por encima de 4. **Sin banda de tolerancia**: la igualdad se avisa, no se amortigua.

La **referencia** es la superficie **calculada** si hay polígono válido y la **declarada** si solo hay punto —un
punto no tiene superficie calculada—. La comparación usa el **valor almacenado**, sin reducirlo antes para
presentación. Si declarada y calculada caen a **distinto lado** del umbral → **revisión humana**, nunca la cifra
favorable.

### Decimales: cuatro cosas distintas

| Qué | Dónde | Qué NO es |
| --- | --- | --- |
| **Valor numérico** | La coordenada | No cambia por cómo se escriba: `-79.5` = `-79.500000` |
| **Formato de intercambio** | 6 decimales al exportar, como **números** | No es precisión ni resolución |
| **Resolución del dato** | Declarada `numeric(12,4)`, calculada `numeric(14,6)` | Representación, no exactitud |
| **Exactitud de captura** | Bloque de calidad de `TL_GIS_TECH`; sin umbral (D-25) | **No se deduce de los decimales** |

Por qué 6: la norma exige **al menos** seis dígitos decimales y el destino **trunca** a seis. **Una coordenada no
se rechaza por sus ceros finales**, y seis decimales **no se presentan como prueba de precisión física**
(RFC 7946 §11.2 advierte justo de eso).

### Truncamiento del destino, simulado

Sobre una **copia**, con `trunc(numeric, 6)`: decimal exacto y **hacia cero**, como muestran los ejemplos del
destino —incluidos los **negativos**, que es el caso normal en Ecuador—. Sobre la geometría **resultante** se
comprueba validez, degeneración y **colapso de vértices**. El **cierre del anillo** es obligatorio y **se excluye**
de la comprobación de duplicados; un duplicado anterior al truncamiento tiene motivo propio y manda a revisión.

**La geometría almacenada no se modifica, no se repara y no se reproyecta.** Corregirla sigue siendo crear una
**versión nueva**.

### Tipos y exportación

Admitidos: `Point`, `Polygon`, `MultiPolygon`. **`MultiPoint` NO está implementado** y se declara como tal: el
destino lo admite, Terra Link no lo modela, y no se improvisa —tampoco cómo repartiría `Area` entre varios puntos—.

La exportación con perfil es **por productor** y **convive** con la técnica, que no se tocó. No lleva
`ProducerName` (dato personal) ni `ProducerCountry` (no se registra país de producción; deducirlo sería
inventarlo). `Area` solo acompaña a los puntos y va como **número**. Lo no exportable **se lista con su motivo**, y
«no evaluada» tiene **código propio**: no es lo mismo que «no cumple». El **período de producción** del Art. 9(1)(d)
**no viaja** en el archivo: no hay contrato que diga cómo, y no se inventa la propiedad.

### Resultados

`MEETS_PROFILE` · `DOES_NOT_MEET` · `REVIEW_REQUIRED` · `NOT_EVALUABLE`. Un caso que no se puede decidir **no se
acepta en silencio ni arrastra a los demás a rechazo**: queda con su motivo. Un `CHECK` del esquema impide marcar
`exportable` algo que no sea `MEETS_PROFILE`.

## GPS de campo

Conservar latitud, longitud, hora de captura, precisión horizontal si el dispositivo informa, método y muestras por vértice. Si algunas precisiones faltan, no declarar «peor precisión del polígono: 3 m» basándose solo en las conocidas.

Mostrar número de muestras con precisión, número desconocido y peor precisión conocida con esa etiqueta. El indicador global es incompleto hasta disponer de cobertura suficiente según política. Un null no se sustituye por cero ni por el promedio. Advertir medición débil sin impedir guardar borrador.

## Versionado e impacto

Una evaluación satelital o de riesgo utiliza `plot_version_id` y hash de geometría, no «la parcela actual» mutable. Cambio geométrico crea versión, invalida readiness que dependía del snapshot anterior y genera reevaluación. No reescribir paquetes ya exportados; preparar una nueva revisión.

## Pruebas

Punto válido; polígono válido; self-intersection; CRS distinto/conversión explícita; coordenadas invertidas plausibles; fuera de país con capa conocida; área nula; punto con área declarada; duplicado; borde exacto de umbral; MultiPolygon/hole según perfil; mezcla de GPS conocido/desconocido; modificación con análisis previo; GeoJSON grande/tenant ajeno.

Las capas satelitales deben incluir proveedor, dataset, versión, fecha, resolución, método, cobertura, límites y confianza si el proveedor la define. «Sin alertas» no equivale a «sin deforestación» cuando no existe cobertura suficiente.

## Mapa base local de la captura web (A-01, 2026-10-20)
La captura «dibujar sobre el mapa» usa cartografía real de OpenStreetMap servida **por Terra Link** (MapLibre + PMTiles + servicio `maps`; `infra/maps/README.md`). Referencia visual: no acredita
límites de propiedad, precisión GPS, deforestación ni conformidad y **no ajusta vértices** a elementos del mapa. Coordenadas siempre `[longitud, latitud]` (WGS84), rotuladas; lo marcado se guarda como
`MANUAL_COORDINATES` sin precisión. Sin datos cartográficos: estado explícito y entrada manual. Sin teselas, geocodificación ni CDN externos.
