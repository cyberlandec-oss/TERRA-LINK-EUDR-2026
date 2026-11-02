# Matriz del recorrido completo: qué está demostrado y dónde se detiene (2026-10-15)

> **Actualización 2026-10-21**: el mismo encadenamiento se recorrió **desde la web, un rol por transición**, sobre los datos DEMO: `docs/qa/RECORRIDO_INTEGRAL_WEB_2026-10-21.md` (15 transiciones; 0 defectos del producto; bloqueos esperados en riesgo, expediente y despacho; 2 puntos no definidos). Esta matriz (API/integración) sigue vigente.

Preparación de **P0-031**. Esto **no inicia ni completa el piloto**: no hay operadores reales, ni dataset de piloto,
ni Android real, ni restauración de respaldo. Preparar documentos y ejecutar pruebas sintéticas no es operar.

Validación de referencia: `validation-results/2026-10-15T18-33-43-757Z` — **APROBADA**: **61 suites, 545 pruebas**
de integración y **62 E2E**, con OpenAPI validado (192 rutas). Acredita el perfil técnico `EUDR_GEO_V1` (D-05.A) y
el cierre de P0-009 y P0-010.

Anterior: `validation-results/2026-10-15T04-25-29-508Z` — APROBADA sobre el árbol que se confirmó como
**`2c1ab60`**: **60 suites, 519 pruebas** de integración y **61 E2E**. La corrida se ejecutó **antes** de ese
commit, sobre su contenido exacto; cómo se comprobó esa correspondencia está en
`docs/qa/EVIDENCIA_D32_D33_2026-10-15.md` §«Correspondencia entre la corrida y el commit». **A la corrida no se le
atribuye un SHA que aún no existía.**

Posterior a esa validación, el 2026-10-15 se ejecutaron además, sin volver a correr `validate` completa (son cambios
de prueba y documentación, no de producto): el recorrido integral de integración y el archivo
`e2e/tests/productos.spec.ts` **completo, dos veces y en dos ordenaciones distintas** (§«Aislamiento»).

## Cómo leer la columna «evidencia»

| Tipo | Qué acredita | Dónde |
| --- | --- | --- |
| **U** unitaria | Invariantes y funciones puras. No toca base ni red | `apps/api/src/**/*.spec.ts` |
| **I** integración | PostgreSQL/PostGIS y Redis **reales**, base aislada `*_test`, datos sintéticos | `apps/api/test/**/*.int-spec.ts` |
| **N** navegador (E2E) | Chromium real contra la app, base `terra_link_e2e` | `e2e/tests/*.spec.ts` |
| **R** revisión por rol | Navegador real sobre datos DEMO, con capturas | `e2e/review/*.mjs` |
| **E** emulador | Android **emulado**; histórico, no dispositivo físico | `docs/qa/EVIDENCIA_EMULADOR_*` |
| **C** campo | Operadores reales, dispositivo real | **No ejecutado** |

Y la distinción que más importa aquí: **un bloqueo correcto demuestra la compuerta, no la operación que impide**.
Que el despacho se rechace no acredita que un despacho vaya a funcionar cuando se desbloquee.

## El recorrido, transición por transición

| # | Transición | Requisito y fuente | Implementación | Evidencia | Prueba integral pendiente | Bloqueo real → decisión |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Alta de **productor** (identidad cifrada, duplicados) | RF-04/05; S1 §§10–12 | P0-004/005 | I `producers`, `producer-matching`, `producer-identity-encryption` · N `productores` · R | Volumen de piloto (20–50 productores) | — (volumen es P0-031) |
| 2 | Productor → **parcela** | RF-06; S1 §§13–14 | P0-006 | I `plots` · N `parcelas` · R | Captura en campo | Ensayo Android real (gate aparte) |
| 3 | Parcela → **versión geométrica** (punto, polígono, GeoJSON) | RF-07/08/09; docs/10 | P0-007/008/009 | I `location-capture`, `polygon-drafts`, `geometry-imports` · N `ubicacion`, `poligono`, `geojson` · E | GPS nativo en dispositivo real | Ensayo Android real |
| 4 | Geometría → **validez GIS técnica** | RF-10; docs/10 | `TL_GIS_TECH 1.0.1` | I `gis-evaluation` · R `gis` · **I recorrido integral** | — | — |
| 4b | Geometría → **perfil técnico de destino** | RF-09/10; D-05.A | `EUDR_GEO_V1 1.0.0` (desde el 2026-10-15), regla y tabla **aparte** | I `geo-profile` (26) · N `geojson` · **I recorrido** (`MEETS_PROFILE`) | Prueba contra el **servicio real** del destino | — (D-05.A adoptada; **no** acredita conformidad) |
| 4c | Perfil técnico → **conclusión regulatoria** | RF-10; docs/13 | No implementado a propósito | **I recorrido** (`LEGAL_APPLICABILITY_NOT_DECIDED`) | Qué actor es cada usuario y qué acredita el perfil | **D-05.B** |
| 5 | Parcela → **entrega** con origen declarado | RF-12; S1 §§22–24 | P0-012 **DONE_LOCAL** | I `deliveries` · R `entregas` · **I recorrido** | Cierre con diferencia **en operación real**, con operadores | — (D-33 adoptada el 2026-10-15) |
| 6 | Entrega → **recepción** y pesaje | RF-12; docs/06 | P0-012 **DONE_LOCAL** | I `deliveries` · **I recorrido** (500 declarados ≠ 480 recibidos, conservados por separado) | Recepciones parciales en operación real | — |
| 6b | Recepción → **cierre de la entrega con diferencia** | RF-12; D-33 | P0-012 (desde el 2026-10-15) | **I recorrido** (20 kg faltantes, motivo obligatorio, `delivery:correct` exigido, recepción posterior rechazada) · I `d32-d33` · N `productos` | Cierre con diferencia hecho por personal de acopio real | — (D-33 adoptada el 2026-10-15) |
| 7 | Recepción → **calidad** (muestra, resultado, decisión) | RF-12; D-33 | P0-012 | I `deliveries` · **I recorrido** (liberada por decisión humana, con versión de límites **declarada y no verificada**) | Catálogo de parámetros y límites verificados | **Límites de aceptación de calidad: siguen sin decidir.** No bloquean el cierre de P0-012, pero ningún resultado de calidad está contrastado contra un catálogo publicado |
| 8 | Recepción → **lote** | RF-16; S1 §§25–27 | P0-016 **DONE_LOCAL** | I `lots` · R `lotes` · **I recorrido** (origen `COMPLETE`) | Volumen de piloto | — |
| 9 | Lote → **proceso** (fermentación cerrada con merma) | RF-16; QA-06 | P0-016 **DONE_LOCAL** | I `lots` · **I recorrido** (480 = 430 + 50, rendimiento en masa) | — | — |
| 10 | Proceso → **secado cerrado** | RF-16; D-39.3; D-32 | P0-016 **DONE_LOCAL** (desde el 2026-10-15) | **I recorrido** (sin humedad no cierra; con 7,2 %BH sí: 100 = 90 + 10) · I `d32-d33`, `lots` · N `productos` | Secado real con medidor en campo | — (D-32 adoptada el 2026-10-15; siguen sin definirse los **límites de aceptación**, las **unidades de peso adicionales** y la **comprobación con operadores reales**) |
| 11 | Proceso → **inventario** (ledger única fuente) | RF-17; QA-06 | P0-017 | I `inventory` · R `inventario` · **I recorrido** (conciliación sin diferencias) | Concurrencia bajo carga de piloto | — |
| 12 | Lote → **evaluación de riesgo** | RF-20; docs/13 | P0-020; **mecanismos D-07 adoptados** (2026-10-15); catálogos `0.1.0`/`0.2.0` **sin adoptar y sin severidades** | I `risk` · **I `d07-mecanismos` (16)** · R `riesgo` · **I recorrido** | Severidad real (exige publicar y adoptar un catálogo) y conclusión regulatoria | **Matriz del catálogo** (no aprobada) · **D-07.5 y D-07.6** |
| 13 | Riesgo → **mitigación** | RF-21; docs/13 | P0-021 | I `mitigations` · R `mitigaciones` · **I recorrido** (causa no accionable rechazada) | Verificación con soportes reales | — (las causas de D-05/D-09B no se mitigan a propósito) |
| 14 | Lote → **expediente DD** (instantánea y revisión) | RF-22; docs/13 | P0-022 | I `dd` · R `diligencia` · **I recorrido** (readiness BLOCKED) | READY con datos reales | **Seis requisitos no evaluables**: `GEOLOCATION_PROFILE` (D-05), `DEFORESTATION_ANALYSIS` (D-09 parte B), `LEGAL_PROFILE` (P1-005), `RISK_CATALOG_APPROVED` y `REGULATORY_CONCLUSION` (D-07), `SHIPMENT_LINK` (D-34/P0-029) |
| 15 | Expediente → **paquete DD exportado** | RF-22; docs/13 | Generador probado con fixture | I `dd` | Exportar un paquete de un expediente READY | Los **seis** de la fila 14 |
| 16 | Lote → **embarque** (comprador, ítems, reserva) | RF-29; docs/05 | P0-029 | I `shipments` · R `embarques-web` · **I recorrido** (reserva sin reducir existencia) | — | — |
| 17 | Embarque → **despacho** | RF-29; QA-06/12 | Caso de uso completo, compuerta cerrada | I `shipments` · **I recorrido** (`DISPATCH_BLOCKED`) | Despacho real de extremo a extremo | **D-34** + preflight (paquete DD, evidencia, compuerta) |
| 18 | Transversal: **documentos y evidencias** | RF-18/19; docs/12 | P0-018/019 | I `documents`, `evidence`, `scanner-limits`, `storage-sweeper` · R | Evidencia que acredite un requisito DD real | **D-37** (autoverificación) · **D-42** (satélite→evidencia) |
| 19 | Transversal: **auditoría** | RF-25; docs/07 | P0-025 **DONE_LOCAL** | I `audit` · R `auditoria` | Auditoría de un recorrido completo de piloto | **D-38** (formato y retención): política pendiente, **no** un criterio incumplido |
| 20 | Transversal: **offline y sincronización** | RF-23/24; docs/11 | P0-023/024 | I `sync` · E emulador · R `movil-web-preview` | Captura y sincronización en dispositivo real | Ensayo Android real · **D-40** |
| 21 | Transversal: **satélite** | RF-28; S1 §§39–41 | Adaptador Whisp de **desarrollo** | U `egress`, `provider`, `whisp` · I `satellite` · R `satelite` | Llamada a un proveedor real | **D-09 parte B** |
| 22 | Transversal: **reportes e indicadores** | RF-30; S1 §60/§97 | P0-030 | I `reports` (incluye `plots_valid` contra `EUDR_GEO_V1`), `reports-entities` · R | Cifras de un piloto real | **D-07** (distribución de riesgo) y **D-05.B** (qué significa el resultado). `plots_valid` **ya se calcula**: declara perfil y versión y separa cumple / no cumple / revisión / no evaluable / sin evaluar |
| 23 | Transversal: **autorización y aislamiento** | RF-02/03; docs/07 | RBAC versionado | I `rbac` + pruebas por módulo · **I recorrido** (organización ajena) | Elevación de SUPER_ADMIN **y concesiones entre organizaciones** (los dos criterios abiertos de P0-003) | **D-04** · contrato de concesiones (ADR-0002, P1-001) |

## Lo que el recorrido integral demostró de una sola pasada

`apps/api/test/recorrido-integral.int-spec.ts` (10 casos, base aislada, datos sintéticos) recorre la cadena entera y
deja escrito su propio alcance al terminar:

**La cadena completa, transición por transición**, tal como la ejecuta la prueba:

1. **Origen.** Productor → parcela con polígono → evaluación técnica `VALID` (que **no** es validez regulatoria) →
   **perfil técnico de destino** `MEETS_PROFILE` con `EUDR_GEO_V1` (que tampoco lo es: son dos dictámenes y el
   segundo dice, en su propio resultado, que está comprobado **en documentación, no contra el servicio real**).
2. **Recepción con diferencia.** Entrega de **500 kg declarados** → recepción de **480 kg**. Las dos cifras se
   conservan por separado: recibir menos **no ajusta** lo declarado.
3. **Calidad.** Muestra → resultado → **decisión humana** de liberación, con versión de límites **declarada y no
   verificada** (no hay catálogo publicado). No es liberación jurídica.
4. **Cierre de la entrega con motivo (D-33).** Cerrar sin motivo se rechaza; cerrarla quien solo confirma
   recepciones se rechaza (`delivery:correct`); con motivo se cierra y queda **20 kg** de diferencia justificada.
   Después: **recepción nueva rechazada** (`DELIVERY_CLOSED`) y **sin reapertura**.
5. **Lote.** Recepción → lote con origen `COMPLETE`.
6. **Fermentación con merma.** 480 consumidos = **430 producidos + 50 de merma** declarada.
7. **Secado con su medición (D-32).** Sin humedad **no cierra** (`DRYING_MOISTURE`), y mientras el proceso está
   abierto el material sigue **reservado**, no desaparece. Con **7,2 %BH**, método y responsable, cierra:
   **100 consumidos = 90 de salida + 10 de merma**. La humedad **no convierte masas**.
8. **Conservación del origen.** El lote seco mantiene `origin.status = COMPLETE` **tras dos transformaciones**, y el
   recorrido **inverso** llega desde el lote de salida hasta el productor y la parcela.
9. **Conciliación.** El ledger concilia **sin diferencias** después de cada cierre: no hay existencias inventadas ni
   perdidas entre pasos.
10. **Riesgo.** Técnico `INCOMPLETE` con severidad `NOT_ASSESSED` y conclusión `UNDETERMINED`, por diseño.
11. **Expediente.** Cantidades y origen **cumplidos**; readiness `BLOCKED` (ver abajo).
12. **Embarque.** Reserva **real** sobre el ledger: 330 físicos tras el secado, 200 reservados, 130 disponibles.
    Reservar **no reduce** la existencia.
13. **Aislamiento.** La organización ajena no puede leer ni referenciar nada de la anterior.

**Cinco bloqueos comprobados**, cada uno con su decisión responsable. Eran **seis** hasta el 2026-10-15: la adopción
de D-32 y D-33 levantó el del cierre de entregas, que el recorrido **atraviesa ahora de verdad** (paso 4 de arriba),
no por haberlo rebajado. El del secado nunca fue un bloqueo de esta lista, sino un corte dentro del tramo 10.
La adopción de **D-05.A** no cambió el número: **sustituyó** el bloqueo de geometría por uno más preciso
(`LEGAL_APPLICABILITY_NOT_DECIDED → D-05.B`), porque lo que falta ya no es el formato sino a quién obliga la norma.

> **Corrección de una cifra anterior.** Las revisiones previas de esta matriz decían «cuatro» y omitían el factor
> satelital, que la prueba sí registra. La cifra correcta la imprime el propio recorrido al terminar
> (`transiciones demostradas: 12; bloqueos comprobados: 5`), y es la que figura aquí. La duodécima transición es
> el **perfil técnico de destino**, que se añadió al recorrido el mismo día al adoptar D-05.A.

| Bloqueo | Código observado | Decisión |
| --- | --- | --- |
| Perfil técnico → conclusión regulatoria | `LEGAL_APPLICABILITY_NOT_DECIDED` | **D-05.B** |
| Riesgo → severidad y conclusión | Sin catálogo **adoptado** por la organización: `NOT_ASSESSED` con su motivo | **D-07**: mecanismos adoptados (2026-10-15), **catálogo no**. La conclusión sigue `UNDETERMINED` por D-07.5/D-07.6 |
| Riesgo → factor satelital | `SATELLITE_COVERAGE_UNKNOWN` | **D-09 parte B** |
| Expediente → READY y paquete | `READINESS_NOT_MET` (`GEOLOCATION_PROFILE`, `DEFORESTATION_ANALYSIS`) | **D-05.B** y D-09 parte B |
| Embarque → despacho | `DISPATCH_BLOCKED` (`DD_PACKAGE`, `EVIDENCE`, `GATE`) | **D-34** |

Lo que **no** cambia con los cierres de P0-012 y P0-016: el expediente sigue sin poder llegar a `READY` y el despacho
sigue detenido. Cerrar una entrega o un secado **no acerca ninguno de los dos**.

**Nota sobre D-05 (2026-10-15).** La decisión se partió en dos y **solo una se adoptó**:

- **D-05.A · perfil técnico** — **ADOPTADO para desarrollo local** e implementado como `EUDR_GEO_V1`. El recorrido
  ya no devuelve `DESTINATION_PROFILE_NOT_EVALUATED`: ahora atraviesa la transición 4b con `MEETS_PROFILE`.
- **D-05.B · aplicabilidad jurídica** — **PENDIENTE**. El bloqueo no desapareció: **se movió y se precisó**, de
  `DESTINATION_PROFILE_NOT_EVALUATED → D-05` a `LEGAL_APPLICABILITY_NOT_DECIDED → D-05.B`.

**Lo que sigue exactamente igual**: el expediente no llega a `READY`, el despacho sigue detenido, **D-07** y el
catálogo `NOT_APPROVED` no se tocaron, y **ninguna compuerta ni conclusión regulatoria cambió**. Cumplir el perfil
técnico **no es conformidad**, y nada de esto se ha probado contra el servicio real del destino.

Un detalle que sale de ejecutarlo y no de leerlo: en el preflight del embarque, **calidad pasa** (`OK`) porque el
recorrido la liberó de verdad. Lo que detiene el despacho no es la calidad, sino el paquete DD, la evidencia y la
compuerta. Antes de este recorrido, la evidencia disponible dejaba las cuatro juntas en `BLOCKED`.

## Lo que falta probar (y no depende de ninguna decisión)

1. **Volumen de piloto** (QA-17): 20–50 productores, 20–100 parcelas, 1–3 lotes operados por personas, sin cambios
   manuales en la base. Es el criterio central de P0-031 y **no está ejecutado**.
2. **RPO/RTO con volumen real.** QA-16 está **completa en sus dos mitades**: respaldo y restauración verificados
   (13-oct sobre 37 migraciones; **15-oct sobre las 39 actuales**) y **la aplicación operando sobre la copia** en una
   instancia aislada —API y web propias— con 9 comprobaciones correctas, 3 bloqueos esperados y 0 fallas
   (`docs/qa/EVIDENCIA_QA16_RESTAURACION_2026-10-15.md`). Lo que **no** está medido son RPO/RTO: los tiempos (3 s de
   volcado, 13 s de restauración) son de un conjunto mínimo y no se extrapolan.
3. **Android real** (QA-08): captura, offline y sincronización en dispositivo físico. Hay evidencia de **emulador**,
   que es otra cosa y así está registrada.
4. **Capacitación impartida.** El **manual y el guion** sí existen (`docs/MANUAL_OPERACION.md`), escritos el
   2026-10-15; lo que no existe es la capacitación **dada a operadores**. Escribir un manual no es impartirlo.
5. **Validación con operadores reales de lo cerrado el 2026-10-15.** El cierre de entregas con diferencia y el
   secado con humedad están demostrados en integración y en navegador, con **datos sintéticos**. Nadie que reciba
   cacao ni mida humedad los ha usado todavía.
6. **Límites de aceptación de calidad y de humedad.** Siguen **sin decidir** (D-32/D-33). El tope de 100 de la
   humedad es **estructural**, no un criterio de calidad, y la versión de límites que se registra al liberar es
   **declarada por quien decide** y el sistema **no la verifica**.
7. **Unidades de peso adicionales** con sus factores exactos (D-32). Hoy solo KG.

## Aislamiento de las pruebas de navegador (2026-10-15)

`e2e/tests/productos.spec.ts` es **serial** y sus 24 pruebas comparten organización, catálogo y existencias. Cuando se
añadieron las comprobaciones de D-32 y D-33 se colocaron **al final del archivo** justamente para que el secado no
tocara los saldos que verifican inventario, riesgo y reportes. Eso funcionaba, pero convertía la **posición** en parte
del contrato: mover una prueba rompía otra, y el motivo solo estaba en un comentario.

**Qué se cambió.** Las tres pruebas de D-32/D-33 preparan ahora por API su **propio material** —productor
`SEC-E2E-1` / `CIE-E2E-1`, centros `CA-SEC-E2E` / `CA-CIE-E2E` y productos `CACAO_FERM_SEC_E2E`,
`CACAO_SECO_E2E`, `CACAO_BABA_CIE_E2E`— y no tocan el productor `ENT-E2E-1`, el centro `CA-E2E` ni los productos
`CACAO_BABA_E2E` / `CACAO_FERM_E2E` de las demás. La tercera, que antes se **saltaba en silencio** si no encontraba
una entrega cerrada dejada por la anterior, crea y cierra la suya por API: ya no hay `test.skip` que oculte una
comprobación no ejecutada.

**Las verificaciones de inventario no se tocaron**: `P0-017` sigue comprobando los 750 kg de cacao fermentado en
Centro E2E, el traslado de 100 kg a Bodega E2E y la merma de 2 kg con motivo. Lo que se elimina es la dependencia de
orden, no la verificación.

**Cómo se demostró** (dos corridas del archivo completo, el 2026-10-15):

| Corrida | Orden del bloque D-32/D-33 | Resultado |
| --- | --- | --- |
| 1 | Al final, como estaba | **24/24** en 3,0 min |
| 2 | **Movido antes** de lotes, inventario, riesgo y reportes | **24/24** en 1,0 min |

La segunda es la que importa: es exactamente la posición que antes rompía las pruebas de saldos. El bloque quedó
**en esa posición nueva**, de modo que la independencia de orden está respaldada por la ejecución habitual del
archivo y no por un comentario.

**Lo que esto no demuestra**: que el archivo sea paralelizable. Sigue siendo `mode: 'serial'` con un trabajador, y
las pruebas siguen compartiendo la organización y las cuentas que crea la de preparación. Lo demostrado es más
estrecho y más útil: **el bloque D-32/D-33 ya no depende de dónde esté**.

**No se reejecutó `npm run validate` completa** por este cambio: es código de prueba y documentación, sin cambios en
el producto. Lo ejecutado fue el archivo E2E afectado (dos veces) y el recorrido integral de integración.
