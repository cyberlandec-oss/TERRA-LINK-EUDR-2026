# Sesión 2026-10-15 — Consolidación de P0-012/P0-016 y adopción de D-05.A

Continuación de `SESION_2026-10-15_D32_D33.md`. **No se adoptó ninguna decisión nueva** y **no se modificó ninguna
compuerta regulatoria.** D-07, D-09, D-34, D-37, D-38 y D-42 siguen exactamente donde estaban.

## 0. Despliegue levantado y verificado

| Comprobación | Resultado |
| --- | --- |
| Contenedores | 7, todos arriba; api/web/postgres/redis/scanner `healthy` |
| `localhost:3000` · `4000/api/docs` · `3001` | **200**, **200**, **200** (3001 relanzado: es un proceso de Node, no un contenedor) |
| Migraciones | **40** |
| Marcas de migración | de `2026-10-13T15:14:19Z` a `2026-10-15T04:41:52Z`: las primeras **no se reejecutaron**, luego el volumen **no se recreó vacío**. Es lo único que prueba: **no acredita que todos los datos se conserven** |
| Catálogo CTE | `1.6.0`; `DRYING` v2 publicado en esa versión |
| `delivery_closures` | **0** filas: la tabla existe y no se ha usado en la base de desarrollo |
| Datos DEMO | 9 productores · 107 tablas |

Datos, volúmenes, credenciales, respaldos y APK **intactos**. `SATELLITE_LIVE_CALLS` sigue apagado.

## 1. Consolidación de los cierres (P0-012 y P0-016)

Se actualizaron `docs/qa/MATRIZ_RECORRIDO_INTEGRAL.md`, `docs/23_ESTADO_DESARROLLO.md`, `docs/MANUAL_OPERACION.md`,
`docs/sesiones/REANUDAR_2026-10-15.md` y `docs/decisiones/DECISIONES-MINIMAS-PARA-CERRAR.md`.

El secado y el cierre de entregas **dejan de figurar como bloqueados**. Lo que **sí** queda explícito, en cada
documento y no en una nota al pie:

- **Límites de aceptación** de calidad y de humedad: **sin decidir**. El tope de 100 de la humedad es estructural.
- La versión de límites que se registra al liberar calidad es **declarada por quien decide** y el sistema **no la
  verifica**.
- **Unidades de peso adicionales** (D-32): no existen; hoy solo kg.
- **Validación con operadores reales**: ninguna. Todo lo demostrado usa datos sintéticos.
- Las **demás historias abiertas** y los bloqueos de expediente y despacho siguen igual: cerrar una entrega o un
  secado **no acerca** el `READY` ni el despacho.

### Una cifra que estaba mal y se corrigió

La matriz decía **«cuatro bloqueos comprobados»** y omitía el factor satelital. El recorrido integral imprime la
cifra real al terminar. Antes de esta sesión eran **6**; ahora son **5**.

## 2. Recorrido integral ampliado

`apps/api/test/recorrido-integral.int-spec.ts` ya no anota el cierre de entregas como corte
(`SIN_POLITICA_DE_CIERRE`): lo recorre.

| Lo que ahora demuestra | Cómo |
| --- | --- |
| Cerrar **sin motivo** se rechaza | 422 con `reason` entre los campos |
| Quien **solo confirma recepciones** no puede cerrar con diferencia | 403: hace falta `delivery:correct` |
| El cierre con motivo funciona | 200; diferencia **+20 kg** (500 declarados − 480 recibidos) justificada |
| Una entrega cerrada **no admite recepciones nuevas** | 409 `DELIVERY_CLOSED`; `actions.receive = false` |
| Cerrar **no ajusta** lo declarado | 500 y 480 siguen conservados por separado |

Resultado: **11 transiciones demostradas y 5 bloqueos**, frente a 10 y 6. Ejecutado: **10/10 casos**, 56 s.

Lo que el recorrido ya demostraba y se conserva intacto: fermentación (480 = 430 + 50), secado con su medición
(sin humedad no cierra; con 7,2 %BH, 100 = 90 + 10), conciliación del ledger sin diferencias después de cada
cierre, origen `COMPLETE` tras dos transformaciones, recorrido inverso hasta el productor y la parcela, y los
cinco bloqueos restantes con su decisión responsable.

## 3. Aislamiento de las pruebas de navegador

**El problema.** Las tres pruebas de D-32/D-33 estaban al final de `e2e/tests/productos.spec.ts` para que el secado
no moviera los saldos que verifican inventario, riesgo y reportes. Eso hacía de la **posición** parte del contrato,
y el motivo vivía solo en un comentario. Además, la tercera se **saltaba en silencio** (`test.skip`) si no
encontraba una entrega cerrada dejada por la anterior: una comprobación no ejecutada que parecía aprobada.

**Qué se hizo.** Las tres preparan ahora por API su propio material —productor, centro de acopio y productos
exclusivos— y la tercera crea y cierra su propia entrega. **Las verificaciones de inventario no se tocaron**:
P0-017 sigue comprobando los 750 kg en Centro E2E, el traslado de 100 kg y la merma de 2 kg con motivo.

**Cómo se demostró** (no por argumento, por ejecución):

| Corrida | Posición del bloque | Resultado |
| --- | --- | --- |
| 1 | Al final, como estaba | **24/24** · 3,0 min |
| 2 | **Antes** de lotes, inventario, riesgo y reportes | **24/24** · 1,0 min |

El bloque quedó **en la posición nueva**, que es justamente la que antes rompía las pruebas de saldos.

**Lo que esto no demuestra**: que el archivo sea paralelizable. Sigue siendo serial, con un trabajador, y las
pruebas comparten la organización y las cuentas que crea la de preparación.

## 4. Evidencia de versión precisada

La corrida `validation-results/2026-10-15T04-25-29-508Z` se ejecutó **antes** de que existiera `2c1ab60`: su
resumen anota `commit: 7e62c74` y 31 entradas sin confirmar. Ahora está escrito así, con las comprobaciones que
sostienen la correspondencia —padre del commit, 31 segundos de diferencia, y los registros de la corrida mostrando
la suite `d32-d33.int-spec.ts`, los títulos de las tres pruebas E2E nuevas y la salida del recorrido integral tal
como quedó en ese commit— y **con su límite declarado**: git no guarda el árbol de trabajo, así que es
correspondencia fuerte, no igualdad demostrada.

Se deja anotada la mejora que la volvería comprobable: que `scripts/validate-local.mjs` registre un **hash del árbol
probado**. **No se hizo aquí**, para no mezclarla con esta entrega.

## 5. D-05 — revisión 2 y, en el mismo día, revisión 3

### 5.1 Revisión 2 (primer bloque de la sesión)

Separó tres capas que antes se mezclaban —**norma**, **especificación técnica del destino** y **regla interna de
Terra Link**— y fijó el umbral estricto a partir del comportamiento del receptor.

**Dos cosas de esa revisión resultaron equivocadas y se corrigieron el mismo día** (§5.2). Se dejan escritas en vez
de borrarlas, porque explican por qué la revisión 3 existe:

1. Citó la documentación del destino como «referencia de API **v1.2**». El número existe, pero es la versión del
   **documento**, no del servicio.
2. Dio la norma por **inaccesible** y por tanto no verificada.

### 5.2 Revisión 3 (segundo bloque, tras la revisión del responsable)

**a) Fuente mal identificada, corregida.** Y corregida **dos veces**, porque el primer intento también estuvo mal:
llegué a escribir que la cadena «v1.2» **no existía** en las páginas oficiales. Sí existe. La búsqueda que hice
primero corría sobre el **texto extraído** de las páginas, no sobre el **HTML**, y por eso no la veía.

Sobre el HTML guardado aparece en dos sitios, y los dos designan el **documento**, no el servicio: el enlace de
descarga `./pdf/EUDR Operator API Reference v1.2.pdf` y el campo `"version": "1.2"` de la configuración del sitio.
El PDF se descargó para confirmarlo (6 686 345 bytes, sha256 `317829e5…`).

El error de la revisión 2, entonces, **no fue inventar un número**: fue llamar «versión de la API» a la versión
del documento. Ahora se citan **cuatro** identificadores por separado:

| # | Qué | Valor |
| --- | --- | --- |
| 1 | Versión del **servicio** | **V3** |
| 2 | Versión del **documento** *Operator API Reference* | **1.2** |
| 3 | Fecha de la página GeoJSON (las otras tres no publican fecha) | **17-08-2026** |
| 4 | Revisión del **perfil interno** de Terra Link | `EUDR_GEO_V1` |

**b) La norma SÍ se pudo leer.** El fallo anterior tenía una causa concreta: `eur-lex.europa.eu` responde **HTTP
202 con un desafío JavaScript de AWS WAF** a cualquier petición automatizada. La vía que funciona es el servicio de
la Oficina de Publicaciones (`publications.europa.eu/resource/celex/<CELEX>`). Con ella se recuperó el consolidado
**`02023R1115 — EN — 26.12.2025 — 002.001`** y el Reglamento (UE) 2025/2650.

Citados ahora **verbatim**: Art. 2(28) geolocalización, Art. 2(27) parcela, Art. 2(15) y 2(15a) actores,
Art. 4a(5) dirección postal, Art. 9(1)(d) y Art. 38 fechas de aplicación.

**c) Referencias guardadas con su huella.** Copias fechadas en `docs/sources/eudr-is-2026-10-15/` (4 páginas) y
`docs/sources/eudr-norma-2026-10-15/` (2 textos), cada una con URL, fecha, tamaño y **sha256** en su manifiesto.
Se distinguen tres grados de certeza: **documentado**, **comprobado contra el servicio** y **propuesto por
Terra Link**. **Ninguna regla es del segundo grado**: nadie ha importado un archivo en TRACES desde Terra Link, y
leer la documentación no demuestra una importación aceptada.

**d) D-05 se parte en dos.** **D-05.A**, perfil técnico de intercambio, decidible por el equipo con 20 reglas
concretas. **D-05.B**, aplicabilidad jurídica, que solo puede decidir un responsable regulatorio. El formato
técnico **ya no depende** de resolver si Terra Link llegará a presentar un DDS: preparar un archivo no es
presentarlo, y esa presentación tiene su propio alcance y autorización.

**e) Cálculos corregidos.**

| Antes (revisión 2) | Ahora (revisión 3) |
| --- | --- |
| «Comparar a 6 decimales, presentar a 4» | Comparar sobre el **valor almacenado**, sin reducción previa; el redondeo de presentación nunca alimenta la comparación |
| Precisión del dato sin declarar | Declarada: declarada `numeric(12,4)` (**4** decimales, cuantizada en 0,0001 ha, la API **rechaza** más precisión) y calculada `numeric(14,6)` (**6**). Y precisión de representación **≠** exactitud de medición |
| Truncamiento y superficie, juntos | **Separados**: el truncamiento actúa sobre coordenadas en el destino; la superficie se calcula sobre la geometría almacenada |
| Ejemplos de truncamiento solo positivos | Incluidos los **negativos** de la propia fuente, que muestran truncamiento **hacia cero** — el caso normal en Ecuador |
| Duplicados sin matizar | **Cierre obligatorio del anillo** distinguido de los **vértices que colapsan**: el primero se exige y se excluye de la comprobación; el segundo se detecta y rechaza |
| Nada sobre la geometría truncada | Se **valida la geometría resultante** del truncamiento, sobre copia, **sin reparar ni modificar el original** |

**f) El modelo no se amplía.** El destino admite `MultiPoint`; Terra Link no lo soporta —el `CHECK` del esquema
solo admite `POINT`, `POLYGON`, `MULTIPOLYGON`— y queda declarado como **capacidad no implementada**. No se
inventa ninguna regla para repartir `Area` entre varios puntos: la fuente no la da.

### 5.3 Dos hallazgos nuevos que ninguna revisión anterior tenía

1. **El mínimo legal y el máximo del receptor coinciden en 6 decimales.** El Art. 2(28) exige «at least six decimal
   digits»; el destino **trunca** a seis. Exportar **menos** de seis incumpliría la norma. Hoy la exportación
   técnica emite `ST_AsGeoJSON(geometry, 17)`: diecisiete.
2. **El Art. 9(1)(d) exige también «the date or time range of production»**, junto a la geolocalización. Terra Link
   registra período de cosecha por entrega, pero **no está vinculado al perfil de la parcela ni se exporta**. Es
   trabajo nuevo, nombrado y no resuelto en la propuesta.

### 5.4 La vía de la dirección postal no es «para cualquier pequeño productor»

La revisión 2 la enunció demasiado laxa. El Art. 4a(5) la reserva a los **«micro or small primary operators»**, y
esa figura exige **todas** estas condiciones a la vez: ser **«operator»** —quien coloca **por primera vez en el
mercado de la Unión** o exporta desde ella—, ser persona física o micro/pequeña empresa según la Directiva
2013/34/UE, estar establecido en un **país clasificado de riesgo bajo** conforme al Art. 29, y colocar productos
que **ese mismo operador** haya producido en parcelas de ese país.

La primera condición por sí sola puede excluir a la mayoría de usuarios de Terra Link: una cooperativa de Ecuador
que vende a un importador europeo **normalmente no es el operador**. Y queda un dato sin verificar: el Art. 29
parte de que **todos los países tienen riesgo estándar** hasta que la Comisión publique la lista por actos de
ejecución. **Si Ecuador figura ahí, y en qué categoría, no se comprobó.** Sin eso, la vía postal **no se da por
disponible ni por descartada**.

### 5.5 Ocho incertidumbres nombradas, ninguna rellenada

Entre ellas: cómo calcula el destino la superficie de un **polígono** y si lo hace antes o después de truncar; el
alcance real de su regla sobre «overlapping sides»; dos **inconsistencias del propio documento oficial** (ejemplos
de Tipo II que llevan `Area` en features `Polygon`, y un ejemplo de `Point` con un nivel de anidamiento de más); y
el comportamiento **real** del servicio, que exigiría un ensayo contra el entorno de aceptación —con credenciales y
autorización, emparentado con D-09 parte B y **no autorizado aquí**—.

## 5.6 Revisión 4 y adopción de D-05.A

El responsable de producto **adoptó D-05.A como perfil técnico provisional para desarrollo local**, con ajustes.
**D-05.B sigue pendiente.**

### Fuentes, antes de implementar

| Qué | Resultado |
| --- | --- |
| **Consolidación posterior** | Existe `02023R1115-20260918` (003.001). Se recuperó y **se comparó** con la de diciembre: la diferencia la introduce **M3** (Reglamento Delegado (UE) 2026/2102) y está **entera en el Anexo I**. **Ningún artículo cambió**, verificado uno a uno. Para cacao, `1801` no cambia; solo `1802` excluye residuos. La copia anterior **se conserva como historia** |
| **Ecuador** | **`standard risk category`** en la lista oficial de la Comisión, con fecha y hash. **Cierra en contra** la vía de dirección postal: el Art. 2(15a) exige **riesgo bajo**. Y queda escrito que esto **no es** el riesgo de una parcela ni de un lote, que sigue dependiendo de D-07 |

### Lo implementado

`EUDR_GEO_V1@1.0.0`, migración `0041_eudr_geo_profile`, tabla `geo_profile_evaluations` **append-only**.

- **Separado de `TL_GIS_TECH` de verdad**: regla, tabla y versión propias. Las evaluaciones técnicas **no se
  migraron, ni se recalcularon, ni se invalidaron**, y una prueba lo comprueba fila por fila. **Los dos dictámenes
  se muestran juntos** y pueden discrepar: el polígono con hueco es técnico `VALID` y perfil `DOES_NOT_MEET`.
- **Umbral estricto**, con **4 ha exactas admitidas** y aviso de igualdad. **Sin banda δ**: la que proponía la
  revisión 3 **se retiró**, porque fijar un δ sin fuente sería inventar una regla y acabaría funcionando como una
  condición de cierre encubierta.
- **Contrato de decimales corregido**, en cuatro capas que ya no se mezclan: valor numérico · formato de
  intercambio (6 decimales, escritos como **números**) · resolución del dato (declarada `numeric(12,4)`, calculada
  `numeric(14,6)`) · exactitud de captura. **Los decimales escritos no acreditan exactitud** y **una coordenada no
  se rechaza por sus ceros finales**: `-79.5` y `-79.500000` son el mismo valor.
- **La comparación con el umbral usa el valor almacenado**, sin reducirlo antes para presentación.
- **Truncamiento y cálculo de superficie, separados.** La simulación trunca **hacia cero** en decimal exacto
  (`trunc(numeric, 6)`), incluye **coordenadas negativas** —el caso normal en Ecuador— y **valida la geometría
  resultante**. **El original no se modifica, no se repara y no se sustituye.**
- **Cierre del anillo distinguido de los duplicados problemáticos**: repetir la primera posición al final es
  obligatorio y **se excluye** de la comprobación; un duplicado previo al truncamiento tiene motivo propio y manda
  a revisión, no a rechazo.
- **El modelo no se amplió**: `MultiPoint` queda **declarado como capacidad no implementada**, y no se inventó
  ninguna regla para repartir `Area` entre varios puntos.
- **Casos ambiguos**: `NOT_EVALUABLE` o `REVIEW_REQUIRED` **con motivo específico**. Un caso que no se puede
  decidir **no se acepta en silencio** ni arrastra al resto a rechazo. Un `CHECK` del esquema impide marcar
  `exportable` algo que no sea `MEETS_PROFILE`.
- **Exportación con perfil, por productor**, junto a la técnica que **no se tocó**: sin `ProducerName` (dato
  personal) ni `ProducerCountry` (Terra Link no registra país de producción: deducirlo sería inventarlo), con
  **lista de no exportables y motivos** y **código propio para «no evaluada»**. **El período de producción del
  Art. 9(1)(d) no viaja en el archivo**: no hay contrato que diga cómo, y no se añadió propiedad ni dato
  permanente a la parcela.

### Historias

**P0-009 y P0-010 pasan a DONE_LOCAL**, con sus criterios originales demostrados y **separados** los pendientes
que no son suyos: **D-05.B** (aplicabilidad jurídica) y la **aceptación por el servicio real** del destino.

### Integración con reportes y expediente

- **Reportes**: la exportación con perfil vive junto a la técnica, que **no se tocó**. `plots_valid` **no se
  cambió**: pasar a contarlo contra el perfil sería tocar un indicador, y eso no se hizo.
- **Expediente**: la prueba más relevante es la que **no** cambia nada. En el recorrido integral, el perfil se
  evalúa **antes** del expediente y aun así `GEOLOCATION_PROFILE` sigue `NOT_EVALUABLE` y el `READY` sigue
  bloqueado. **Adoptar el perfil técnico no acerca el expediente**, y la prueba lo demuestra por ejecución.

### Validación y despliegue

`npm run validate` **APROBADA** (`validation-results/2026-10-15T18-33-43-757Z`): **61 suites, 545 pruebas** de
integración y **62 E2E**, OpenAPI validado con **192 rutas**.

Un apunte de método: **durante la corrida se editó por error un comentario** de `geo-profile.ts`, y **se revirtió
de inmediato**, de modo que el árbol probado es el que se confirma. Se anota porque es exactamente el problema de
correspondencia que esta misma sesión había documentado unas horas antes.

**Despliegue reconstruido y verificado** tras la validación:

| Comprobación | Resultado |
| --- | --- |
| 3000 · 4000/api/docs · 3001 | **200**, **200**, **200** |
| Migraciones | **41** (la `0041` aplicada) |
| Marcas de migración | de `2026-10-13T15:14:19Z` a `2026-10-15T18:52:00Z`: las primeras **no se reejecutaron**, luego el volumen **no se recreó vacío**. **No demuestra por sí solo** que todos los datos se conserven: para eso haría falta cotejar conteos y contenido, como hace QA-16 |
| `geo_profile_evaluations` | existe, **0 filas** (tabla nueva, sin uso en desarrollo) |
| Datos DEMO | 9 productores, intactos |
| `SATELLITE_LIVE_CALLS` | **apagado**, sin tocar |

### Lo que la adopción NO cambió

**D-07**, el catálogo `risk_rule_sets` (`NOT_APPROVED`), el requisito `GEOLOCATION_PROFILE` del expediente y las
demás compuertas: **intactos**. El recorrido integral sigue cortándose en el mismo punto, con un motivo más
preciso: `LEGAL_APPLICABILITY_NOT_DECIDED → D-05.B` en vez de `DESTINATION_PROFILE_NOT_EVALUATED → D-05`.

## 5.7 Consolidación GIS: `plots_valid` y la correspondencia de la corrida

### `plots_valid`, integrado de verdad

Hasta ahora el indicador devolvía `CRITERION_UNDEFINED`: no había criterio que aplicar. Con D-05.A el criterio
existe, y el indicador **se conectó al perfil**:

| Qué | Cómo quedó |
| --- | --- |
| Qué cuenta | El dictamen `EUDR_GEO_V1` de la versión **vigente** de cada parcela. No el `validation_status` estructural ni `TL_GIS_TECH`: son tres cosas distintas |
| Identidad del criterio | Campo propio `criterion` con id, versión actual y **versiones realmente contadas**. Si hay **mezcla de versiones**, lo avisa: un total calculado con dos reglas distintas no es comparable consigo mismo |
| Desglose | **cumple · no cumple · en revisión · no evaluable · sin evaluar**, las cinco separadas |
| Denominador | Solo las **evaluadas**. Las sin evaluar quedan fuera y se declaran: desconocido no es incumplimiento |
| Estado cuando nadie evaluó | **`UNKNOWN`**, no `CRITERION_UNDEFINED`. El criterio existe; lo que falta es ejecutarlo, y son dos cosas distintas |
| Versiones | Un dictamen de una versión geométrica anterior **no se hereda**: crear una versión nueva deja la parcela sin dictamen vigente |
| Permisos | Sin `plot:read`, `RESTRICTED`: sin valor y **sin desglose parcial** |

**P0-030 sigue ABIERTA**, y eso no cambió: la distribución de riesgo depende de **D-07** y del catálogo
`NOT_APPROVED`.

Una corrección de método durante esto: la primera versión de la prueba construía su material en la organización de
la fixture y **rompía otras cinco pruebas** al mover los conteos. Se movió a una organización propia. Es el mismo
error de aislamiento que esta sesión había corregido por la mañana en las pruebas de navegador.

Y una corrección de criterio: un **punto sin superficie declarada** devolvía `DOES_NOT_MEET`. Ahora devuelve
**`NOT_EVALUABLE`**. Decir «no cumple» afirma que se comprobó; lo cierto es que **no se pudo comprobar**. Sigue sin
ser exportable, que era lo importante, pero por el motivo correcto.

**Ejecutado**: `reports.int-spec.ts` **18/18**, suites `geo-profile` + `recorrido-integral` + `reports`
**80/80**, `productos.spec.ts` + `geojson.spec.ts` en navegador **31/31**, `typecheck` y `lint`. **No se repitió
`validate` completa**: el cambio funcional está acotado a estas suites.

### Correspondencia de la corrida con `70c52fb`

La validación aprobada (`validation-results/2026-10-15T18-33-43-757Z`: **61 suites, 545 pruebas, 62 E2E**) se
ejecutó **antes** del commit, como siempre. Su resumen anota `commit: b9b94cf` y **18 archivos sin confirmar**, que
es el contenido que se guardó como **`70c52fb`**.

Lo que **sí** se puede afirmar:

| Comprobación | Resultado |
| --- | --- |
| La corrida partió del commit **padre** de `70c52fb` | `b9b94cf`, el mismo que anota `resumen.json` |
| La corrida ejecutó archivos que **solo existen** en `70c52fb` | `geo-profile.int-spec.ts` aparece entre las 61 suites |
| La corrida ejecutó la prueba de navegador nueva | `geojson.spec.ts` con el caso del perfil, dentro de las 62 E2E |

Lo que **no** se puede afirmar, y queda dicho:

- **No es una igualdad demostrada.** Git no guarda el árbol de trabajo tal como estaba durante la corrida: esto es
  **evidencia de correspondencia**, no prueba de identidad. Mientras `validate` no registre un **hash del árbol
  probado** —mejora anotada y no hecha—, seguirá siendo así.
- **Durante la corrida se editó un comentario** de `apps/api/src/plots/geo-profile.ts` y **se revirtió de
  inmediato**, antes de que terminara. El archivo confirmado es idéntico al que la corrida probó, pero el episodio
  se registra porque debilita la cadena y porque es exactamente el problema que esta misma sesión documentó horas
  antes.

## 5.8 D-07: mecanismos adoptados e implementados

El responsable de producto adoptó los **mecanismos** D-07.1, D-07.2 y D-07.4. **No se aprobó ningún catálogo.**

### D-07.1 — Aprobación con ámbito

Las definiciones de reglas son **globales** (`risk_rule_sets` no lleva organización), así que se separaron dos
actos que estaban confundidos en una sola columna:

| Acto | Dónde | Quién |
| --- | --- | --- |
| **Publicación global** | `risk_rule_sets.approval_status` | Acto de **migración**. Nadie publica reglas desde la API |
| **Adopción de uso por organización** | `risk_rule_set_adoptions`, append-only | Usuario con `risk:approve_rules`, con fecha, motivo y auditoría |

Una adopción en la organización A **no aprueba reglas en B**, y no se puede adoptar una versión que el proyecto no
haya publicado. **No se amplió `SUPER_ADMIN` ni se resolvió D-04**: el permiso es de ámbito de organización y hoy
solo lo tiene `ORG_ADMIN`.

El actor sale de la sesión. El cuerpo **ni siquiera admite** un campo de actor: enviarlo devuelve `400`, en vez de
ignorarlo en silencio.

### D-07.2 — Severidad

Declarada **por regla y por versión**, agregada por **máximo**. Sin promedio, sin suma y sin score: **D-07.3 no
aplica** y el modelo no los admite.

- **Sin adopción no hay severidad**, y el `CHECK` lo impide: `risk_evaluations_severity_backed`.
- **A.2**: sin hallazgos, `NOT_ASSESSED`. **No se asigna «bajo» por ausencia.**
- Un `HIT` cuya regla no declara severidad **no clasifica**, y se dice cuál.
- La severidad **viaja siempre con su cobertura**: reglas evaluadas, no evaluables, hallazgos sin severidad
  declarada y **categorías sin ninguna regla**. Una clasificación parcial **se declara parcial**.
- **Un hallazgo conocido no desaparece** porque otra regla no se pudiera evaluar: se clasifica igual, y la
  cobertura dice qué quedó fuera.
- **No sustituye al resultado técnico**: la precedencia sigue mandando y un bloqueante no se diluye.

### D-07.4 — Vigencia

Desactualización por cambio de los datos de la instantánea o de la versión de reglas. **La evaluación no se
modifica**: reevaluar crea un registro nuevo y los anteriores quedan intactos con su severidad y su versión. Se
conservan las caducidades documentales y **no se inventaron plazos generales**.

### El candado, más preciso en vez de retirado

El `CHECK` único de la migración 0025 bloqueaba conclusión **y** severidad a la vez. Se sustituyó por **dos**:

| Antes | Ahora |
| --- | --- |
| `conclusion = 'UNDETERMINED' AND severity = 'NOT_ASSESSED'` | `risk_evaluations_conclusion_undetermined`: la conclusión sigue clavada |
| | `risk_evaluations_severity_backed`: severidad **solo** si hay una adopción que la respalde |

**No es una relajación**: lo que antes era «nunca», ahora es «nunca sin que alguien lo haya adoptado». Y la propia
migración **falla** si encuentra una evaluación con severidad o una regla con severidad declarada: nada se migra.

### Matriz del catálogo, para revisar y NO aprobada

`docs/decisiones/D-07-MATRIZ-CATALOGO.md`: las ocho reglas con condición, categoría, severidad propuesta y
**justificación**, datos necesarios, comportamiento cuando faltan, efecto y casos de prueba.

Separa lo que tiene respaldo de lo que no:

| Respaldo | Reglas |
| --- | --- |
| **FUENTE** | `MATERIAL_OF_UNKNOWN_ORIGIN` y `MASS_BALANCE_INCONSISTENT` (`CRITICAL`), y las tres que proponen **no** clasificar |
| **PRODUCTO — hay que firmarlas** | `DATA_MISSING_ORIGIN` (`HIGH`), `GEOMETRY_INVALID` (`HIGH`), `DOCUMENT_EXPIRED` (`MEDIUM`) |

Tres reglas **no clasificarían nunca** con esta propuesta: `MITIGATION_UNVERIFIED` (es trabajo pendiente, no un
hallazgo sobre el cacao), `SATELLITE_COVERAGE_UNKNOWN` (D-09.B) y `GEOLOCATION_PROFILE` (D-05.B: cumplir el perfil
técnico no acredita el requisito regulatorio). Y con cuatro categorías sin reglas, **toda clasificación será
parcial** y el sistema lo dirá.

### En pantalla: la severidad nunca sola

La ficha de riesgo mostraba la severidad **sin su cobertura**. Hoy no engañaba —siempre es `NOT_ASSESSED`—, pero
el día que alguien adopte un catálogo habría mostrado «Alto» a secas, que es justo lo que no debe hacerse. Ahora
la pantalla muestra **«Severidad de los hallazgos evaluados»** con: el motivo, cuántas reglas se evaluaron de
cuántas, cuáles no se pudieron evaluar, qué hallazgos no tienen severidad declarada y **qué categorías no tienen
ninguna regla**. Si la clasificación es parcial, lo dice en negrita antes del dato.

### Verificación

| Qué | Resultado |
| --- | --- |
| `d07-mecanismos.int-spec.ts` | **16/16** |
| Suites relacionadas (`risk`, `reports`, `dd`, `recorrido-integral`, `mitigations`, `d07`) | **94/94** |
| `productos.spec.ts` en navegador | **24/24** |
| `npm run validate` | **APROBADA** (`validation-results/2026-10-15T20-04-51-326Z`): **62 suites, 563 pruebas**, **62 E2E**, OpenAPI **193 rutas** |

**Dos corridas, y por qué.** La primera (`2026-10-15T19-47-14-688Z`) aprobó con las mismas 62/563/62 sobre el árbol
que ya tenía el backend y las pruebas. Después se corrigió la **pantalla** de riesgo —la severidad sin su
cobertura— y se lanzó una **segunda** corrida, que es la que certifica el árbol que se confirma. La segunda fue
**notablemente más lenta** al principio (8 suites en ~25 min frente a 62 en ~12 min); recuperó ritmo y terminó sin
un solo fallo. **No se cortó ni se subió ningún timeout.**

**La causa de esa lentitud NO está confirmada.** Encaja con el patrón de la inestabilidad registrada en
`docs/qa/DIAGNOSTICO_VALIDACION_INESTABLE_2026-10-13.md`, cuya hipótesis principal —picos de latencia del disco
USB— **sigue sin demostrarse**. Que esta corrida fuera lenta y terminara bien **no confirma ni descarta** esa
hipótesis: es un dato más, no una explicación. No se midió nada durante la corrida que permita atribuirla.

**Correspondencia con el commit.** La corrida anota `commit: 2430053` + 24 archivos sin confirmar, que es el
contenido de esta entrega. Como siempre, es **anterior** al commit: evidencia de correspondencia, no igualdad
demostrada.

Una prueba que ya existía cambió de expectativa y conviene decir por qué: comprobaba el candado por su nombre
(`risk_evaluations_no_conclusion`). Ese `CHECK` ya no existe **porque se partió en dos más precisos**, así que la
prueba ahora comprueba **los dos**: que la severidad sin adopción se rechaza y que la conclusión no se puede
escribir de ninguna manera. Es una comprobación más fuerte, no una relajada.

### Lo que NO cambió

`0.1.0` y `0.2.0` siguen `NOT_APPROVED`, **sin severidades** y **sin adopción**. La conclusión regulatoria sigue
`UNDETERMINED`. El expediente **no** se acerca a `READY` y el despacho sigue detenido. La distribución de riesgo de
**P0-030 sigue en `UNKNOWN`**, porque ninguna organización ha adoptado un catálogo que clasifique.

## 6. Qué NO se hizo

- **No** se aprobó D-05 ni ninguna otra decisión. **D-05.A** queda completa y lista para revisarse; **D-05.B** no
  avanza sin un responsable regulatorio.
- **No** se probó nada contra el servicio real de TRACES, ni en producción ni en aceptación: haría falta
  credenciales y autorización, y enviaría geometrías a un tercero.
- **No** se tocó ninguna compuerta ni ningún `CHECK` del esquema para cerrar historias.
- **No** se reejecutó `npm run validate` completa: los cambios son de prueba y documentación. Lo ejecutado fue el
  recorrido integral (10/10), `productos.spec.ts` completo dos veces (24/24 cada una), `typecheck` y `lint`.
- **No** se encendió `SATELLITE_LIVE_CALLS` ni se tocaron datos, volúmenes, credenciales, respaldos ni APK.

## 6.bis Propuesta D-07 preparada (NO APROBADA)

`docs/decisiones/D-07-PROPUESTA.md`. Es un **contrato para decidir**, no un cambio de motor: **no se aprobó ningún
catálogo, no se retiró ningún `CHECK` y no se propusieron pesos ni umbrales**.

Lo que fija:

- **Cuatro dimensiones separadas**: hallazgo técnico observable · calidad y completitud del dato · severidad ·
  conclusión regulatoria. Y las cuatro reglas que no deben romperse, incluida que **la clasificación de país no es
  el riesgo de un sujeto**: Ecuador en riesgo estándar **no** rellena ninguna dimensión de una parcela o un lote.
- **Qué dice cada fuente y qué no.** El único sitio con números es el **ejemplo ilustrativo** de S1 §37
  (`+25/+30/+15/+10`): adoptarlo sería una decisión de producto presentada como derivación de la fuente.
- **Los ocho factores publicados** y las **cuatro categorías sin ninguna regla**. No se proponen reglas nuevas:
  inventarlas sería fabricar criterios de riesgo.
- **`GEOLOCATION_PROFILE` sigue en `NOT_ASSESSED`** pese a D-05.A. Convertir `MEETS_PROFILE` en factor favorable
  sería justo el salto que D-05 prohíbe.
- **Ausencia, antigüedad y contradicción**: un dato ausente **nunca** da resultado favorable; se propone
  distinguir *por qué* falta; la antigüedad **no está decidida** y poner un número sin fuente sería inventarlo; y
  una contradicción **no se resuelve eligiendo**, va a revisión con las dos cifras a la vista.
- **Precedencia ratificada tal cual**: `BLOCKED > REVIEW_REQUIRED > INCOMPLETE > NO_FINDINGS_IN_EVALUATED_RULES`.
  Un bloqueante **no se diluye** y ese último nombre **no se acorta**: no significa «sin riesgo».
- **Qué hace de verdad una mitigación verificada**: habilita **reevaluar**. No cambia el hallazgo, no concluye
  nada y no cierra la revisión por sí sola.
- **Seis decisiones mínimas**, cada una con qué cambia, qué criterio desbloquea y qué prueba lo demostraría. Y la
  separación que evita el bloqueo general: **D-07.2 (vía de severidad) no depende de la conclusión regulatoria**,
  así que **una sola decisión de producto desbloquea dos indicadores de reportes** sin tocar el expediente.
- **Qué revisión especializada hace falta y para qué exactamente**: un responsable regulatorio para D-07.5 y
  D-07.6; para elegir la vía de severidad **no hace falta un jurista**.
- **Conservación**: publicar un catálogo nuevo **no reescribe ni recalcula** evaluaciones anteriores, que siguen
  ligadas a su versión.

## 6.ter Dos precisiones corregidas y un cambio de método (2026-10-15)

**La lentitud de la segunda corrida no tiene causa confirmada.** Escribí que era «consistente con la inestabilidad
del disco USB ya diagnosticada», y eso insinúa una explicación que no existe: la hipótesis H1 de
`docs/qa/DIAGNOSTICO_VALIDACION_INESTABLE_2026-10-13.md` **sigue sin demostrarse**, y una corrida lenta que
termina bien **no la confirma ni la descarta**. Corregido en §5.7.

**Conservar la marca inicial de migraciones no demuestra que se conserven todos los datos.** Escribí «sin pérdida
de datos» apoyándome solo en que las primeras marcas no se reejecutaron. Eso prueba **una cosa más estrecha**: que
el volumen **no se recreó vacío**. Acreditar la conservación exige conteos y cotejo de contenido, que es lo que
hace el procedimiento de **QA-16**. Corregido en §0 y §5.6.

**Cambio de método para el próximo cambio funcional**: **código terminado → commit → `validate` sobre ESE SHA →
documentación de resultados en un commit posterior**. Así la corrida acredita un commit concreto y deja de hacer
falta argumentar correspondencias entre árboles sin confirmar — que es el hilo que ha aparecido tres veces en esta
sesión. Registrado en `docs/16_PLAN_QA.md` y en el REANUDAR.

## 7. Siguiente paso

**D-07**, con la propuesta de §6.bis sobre la mesa. Lo más barato primero: **D-07.1** (quién aprueba un catálogo) y
**D-07.2** (vía de severidad), que son decisiones de producto y desbloquean dos indicadores de reportes sin tocar
la conclusión regulatoria ni el expediente.

**D-05.B** (aplicabilidad jurídica) necesita un responsable regulatorio: qué actor es cada usuario de Terra Link,
la clasificación de riesgo de Ecuador bajo el Art. 29, las condiciones del Art. 2(15a) una por una, y el Anexo III
con la modificación en curso del Reglamento de Ejecución (UE) 2024/3084. **Ya no necesita acceso a EUR-Lex**: el
texto está guardado con su huella en el repositorio.

Aparte, dos trabajos nuevos quedan identificados y **sin hacer**: exportar con **6 decimales** en vez de 17, y
vincular la **fecha o rango de producción** del Art. 9(1)(d) al perfil de la parcela.

**D-07** sigue independiente y con propuesta escrita.
