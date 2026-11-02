# D-34 — Condición de `dd_package_id` y `dispatch_at` en el despacho

Archivo: `docs/decisiones/D-34-PROPUESTA.md` · Revisión **4** (2026-10-16) ·
Estado: **OPCIÓN A ADOPTADA como regla provisional del MVP local**.

> **Revisión 4 (2026-10-16) — lo decidido.** Se adopta la **opción A**: para despachar se exige el paquete final
> de diligencia, **sin** excepción por declarar «no sujeto». Con ella, dos decisiones que la opción A dejaba
> abiertas y que se resolvieron antes de implementar:
>
> | | Decisión | Adoptado |
> | --- | --- | --- |
> | **D-34.A.1** | Qué satisface `SHIPMENT_LINK` | **Vínculo PREVIO**: un ítem de embarque con reserva activa, válida y de la misma organización. **No** exige que la mercancía haya salido |
> | **D-34.A.2** | Dónde se registra la acreditación | **Por ítem** (`shipment_items.dd_package_export_id`). La columna única de `shipments` **queda retirada** |
>
> **Por qué A.1 así**: exigir el despacho habría creado una **dependencia circular irrompible** —despachar exige
> el paquete, el paquete exige `READY`, y `READY` exigiría el despacho—. Ninguna fuente la impone: **S1 §44**
> enumera el contenido del `DueDiligenceEvidencePackage` (`operator, product, quantity, country, plots,
> production_period, suppliers, chain_actors, deforestation_evidence, legality_evidence, risk_assessment,
> mitigation, verification, audit_trail`) y **no incluye embarque, despacho ni `dispatch_at`**.
>
> **Es una política operativa de producto**, no la afirmación de que todo movimiento esté jurídicamente sujeto a
> lo mismo. **No desbloquea el despacho mientras el expediente no pueda aprobarse**, y eso se asumió al
> adoptarla: `READY` sigue inalcanzable por D-05.B, D-07.5, D-07.6, P1-005 y D-09.B.
>
> Implementación y pruebas: migración `0045_d34a_compuerta_despacho`, catálogo KDE **1.7.0**,
> `test/d34a-despacho.int-spec.ts` (**9**, fixtures sintéticas declaradas). Condición escrita en
> `docs/06_DICCIONARIO_DATOS.md`. **P0-029 y P0-017 siguen abiertas.**

> **Revisión 2 (2026-10-16).** Se añaden §8 —las seis preguntas que la revisión 1 dejaba sin responder y que
> hay que responder **antes** de adoptar B— y §9 —correcciones de hecho a la revisión 1, contrastadas contra
> el código—. **B no se adopta.** La revisión 1 recomendaba B; esa recomendación queda **en suspenso** hasta que
> §8 esté resuelta, porque declarar un régimen de destino no puede convertirse, por sí solo, en una forma de
> omitir el paquete.
>
> **Revisión 3 (2026-10-16).** Dos precisiones sobre la propia revisión 2:
> **(i)** `^[A-Z]{2}$` comprueba **dos letras mayúsculas**, no pertenencia al catálogo ISO; decir que
> `destination_country` «está normalizado a ISO» era inexacto, y la carencia del campo es **doble** (§9.a).
> **(ii)** Que `dispatch_at` lo genere el servidor **no impide que sea condicional**: la revisión 2 proponía
> reclasificarlo y quitarle la `C`, y eso era un error. Conserva la `C`; lo que hace falta es **escribir la
> condición** —obligatorio al quedar `DISPATCHED`, ausente antes— y comprobarla dentro de la operación, sin
> exigir que el cliente aporte el sello (§8.1). Ninguna de las dos cambia la política de despacho.

**Nada de esto está adoptado.** Este documento existe para decidir, no para registrar algo hecho. **Decidir no
implementa nada**: lo que aquí se elija sigue necesitando código, una versión nueva del catálogo KDE y sus
pruebas, que se estiman al final.

## 1. El texto exacto de la decisión abierta

De `docs/22_DECISIONES_Y_PENDIENTES.md`, literal:

> **D-34** — **Adoptado para el MVP local (2026-10-10, instrucción de diseño; no validada en campo)**:
> `deliveries.production_period` con precisión día / mes o intervalo de meses / desconocido; meses como modalidad
> principal; desconocido no bloquea y queda pendiente (KDE 1.1.0). **Pendiente**: condición escrita de
> `shipments.dd_package_id` y `shipments.dispatch_at` (embarques P0-029; P0-022 no los usa todavía: el vínculo con
> embarques queda NO EVALUABLE en el expediente). Desde 2026-10-12 la compuerta SHIPMENT_DISPATCH (KDE 1.5.0) los
> marca BLOCKED_PENDING_DECISION: **ningún embarque se despacha hasta resolver D-34**.
> · Producto/trazabilidad · **Pendiente**: condición escrita de los campos de embarque y nueva versión del catálogo KDE

**Lo ya adoptado no se reabre.** La parte de `production_period` está decidida desde el 2026-10-10. Lo que queda
abierto es **solo** la condición de los dos campos del embarque.

### De dónde viene el «C»

`docs/06_DICCIONARIO_DATOS.md`, fila `shipments/items`:

> `shipment_code/buyer/destination/status` **R**; `lot_id/quantity/unit` **R** por item; `dd_package_id` **C**;
> `dispatch_at` **C**

`R` es requerido y `C` es **condicional**. El diccionario marca los dos campos como condicionales **sin escribir
la condición**. El catálogo KDE lo recoge tal cual, con el motivo a la vista:

> `SHIPMENT_DISPATCH_AT` · `requirement: 'CONDITIONAL'` ·
> `condition: { kind: 'undefined_in_contract', note: 'docs/06 marca dispatch_at como condicional sin escribir la condición (D-34).' }`

Eso es lo que hay que resolver: **cuándo son obligatorios**.

## 2. Qué está bloqueado hoy, exactamente

| | |
| --- | --- |
| Compuerta | `SHIPMENT_DISPATCH` (KDE 1.5.0), desde el 2026-10-12 |
| Estado que devuelve | `BLOCKED_PENDING_DECISION` para `dd_package_id` y `dispatch_at` |
| Efecto | **Ningún embarque se despacha.** No es un fallo: es la compuerta haciendo lo que debe mientras falta la condición |
| Historias afectadas | **P0-029** (despacho no demostrado) · **P0-017** (criterio de despacho) · **P0-022** (el requisito `SHIPMENT_LINK` del expediente queda `NOT_EVALUABLE`) |
| Requisitos afectados | **RF-17**, **RF-29** y **RNF-02** (integridad transaccional: el despacho es la única operación del ledger sin probar concurrente contra datos reales) |

**Tres requisitos con una sola decisión.** Es la decisión abierta con mejor relación entre lo que cuesta decidir y
lo que desbloquea.

## 3. Las opciones

La pregunta es una: **¿qué debe existir para que un embarque pueda despacharse?**

---

### Opción A — Siempre obligatorios

`dd_package_id` y `dispatch_at` son **requeridos** para despachar. Sin un paquete de debida diligencia exportado
y sin fecha de despacho, la operación se rechaza.

| | |
| --- | --- |
| **A favor** | Es la lectura más estricta y la más fácil de defender: no sale producto sin expediente. Coincide con el principio del proyecto —«Origen desconocido y datos faltantes siguen siendo desconocidos»— y con que `EXPORTED` signifique algo |
| **En contra** | **Hoy es inalcanzable**: `READY` exige seis requisitos no evaluables (D-05.B, D-09.B, P1-005, D-07.5/.6, el propio D-34) y `DD_PACKAGE` no puede exportarse sin aprobación. Adoptar A deja el despacho **igual de bloqueado que ahora**, pero por un motivo distinto |
| **Consecuencia** | P0-029 y P0-017 **no** se cierran. RNF-02 sigue sin probarse. Se cambia «falta decidir» por «falta el expediente», que es honesto pero no desbloquea |

---

### Opción B — Obligatorios según el destino *(recomendada)*

`dispatch_at` es **siempre requerido** —es el hecho físico: sin fecha no hay despacho que registrar—. `dd_package_id`
es requerido **cuando el embarque declara un destino sujeto a EUDR**, y opcional en el resto.

| | |
| --- | --- |
| **A favor** | Separa **dos cosas distintas** que hoy están pegadas: registrar que la mercancía salió, y acreditar diligencia ante un destino que la exige. Un embarque nacional o a un destino no sujeto no necesita paquete DD, y exigirlo sería inventar una obligación. Permite **probar el despacho** —consumo único, idempotencia, concurrencia— con embarques no sujetos, cerrando RNF-02 sin fingir conformidad |
| **En contra** | Exige un dato que hoy no existe: **si el destino está sujeto a EUDR**. `shipments.destination` es texto declarado, no un país normalizado con régimen. Hay que añadirlo y decidir quién lo determina |
| **Consecuencia** | P0-029 y P0-017 **pueden cerrarse** para el despacho no sujeto. Los embarques a destino sujeto siguen bloqueados —correctamente— hasta que exista el expediente. `SHIPMENT_LINK` pasa de `NOT_EVALUABLE` a evaluable |
| **Riesgo que hay que mirar de frente** | Que «destino no sujeto» se use como atajo para despachar sin expediente. Se mitiga: el régimen del destino es **declarado y auditado**, queda en el evento de despacho, y un embarque declarado no sujeto **no puede** después presentarse como acreditado |

---

### Opción C — Obligatorios al cerrar, no al despachar

Se permite despachar con los dos campos vacíos y se exige completarlos **después**, para cerrar el embarque.

| | |
| --- | --- |
| **A favor** | Desbloquea de inmediato y refleja operaciones reales donde el papeleo llega tarde |
| **En contra** | **Rompe el principio del proyecto.** Un despacho ya ocurrido no se puede condicionar luego: la mercancía salió. Crea un estado «despachado pero sin acreditar» que es exactamente lo que `EXPORTED` no debe significar |
| **Consecuencia** | Cierra P0-029 rápido y a cambio deja el sistema afirmando algo que no sostiene. **Se descarta**, y se deja escrita para que la descarte quien decide, no quien implementa |

---

## 4. Recomendación

**Opción B.** Razón corta: es la única que distingue el **hecho** (salió mercancía) de la **acreditación** (ante un
destino que la exige), y esa distinción es la que el proyecto aplica en todas partes — resultado técnico frente a
conclusión regulatoria, publicación frente a adopción, perfil técnico frente a aplicabilidad jurídica.

A es defendible pero no desbloquea nada hoy; C desbloquea al precio de que `EXPORTED` deje de significar algo.

**Con una condición**: el régimen del destino se declara explícitamente, con su responsable y su momento, y
**nunca** se infiere del nombre del país escrito a mano.

## 5. Qué permitiría demostrar cada opción

| Criterio | Hoy | Con A | Con B | Con C |
| --- | --- | --- | --- | --- |
| **RF-29** «despacho idempotente y grafo destino» | No demostrado | No (sigue sin expediente) | **Sí**, con embarques no sujetos | Sí |
| **RF-17** «reserva/despacho» del inventario | Parcial | Parcial | **Demostrable** | Demostrable |
| **RNF-02** integridad transaccional en el despacho | Sin probar | Sin probar | **Demostrable** (consumo único y concurrencia reales) | Demostrable |
| **P0-022** `SHIPMENT_LINK` del expediente | `NOT_EVALUABLE` | `NOT_EVALUABLE` | **Evaluable** | Evaluable |
| `READY` del expediente | Bloqueado | Bloqueado | **Sigue bloqueado** (D-05.B, D-07.5/.6, P1-005, D-09.B) | Sigue bloqueado |
| Conclusión regulatoria | `UNDETERMINED` | `UNDETERMINED` | **`UNDETERMINED`** | `UNDETERMINED` |

**Ninguna opción habilita `READY`, conclusión regulatoria ni conformidad EUDR.** D-34 desbloquea el **despacho
físico y su registro**, no la acreditación.

## 6. Lo que hace falta DESPUÉS de decidir

Decidir no es implementar. Con la opción B, el trabajo sería:

| # | Trabajo | Dónde |
| --- | --- | --- |
| 1 | Régimen del destino declarado y auditado, con responsable y momento | `shipments`, migración nueva |
| 2 | Escribir la condición en el diccionario: qué hace `C` en cada campo | `docs/06_DICCIONARIO_DATOS.md` |
| 3 | Nueva versión del catálogo KDE con la condición escrita; `SHIPMENT_DISPATCH_AT` deja de ser `undefined_in_contract` | Migración, catálogo KDE |
| 4 | La compuerta `SHIPMENT_DISPATCH` deja de responder `BLOCKED_PENDING_DECISION` y evalúa la condición real | `apps/api/src/traceability` |
| 5 | Pasar el vínculo CTE `SHIPMENT` de `PENDING` a `INTEGRATED` | Catálogo CTE, versión nueva |
| 6 | **Pruebas**: despacho idempotente, consumo único concurrente, bloqueo del embarque sujeto sin paquete, grafo destino, y que un embarque declarado no sujeto **no** aparezca como acreditado | `test/shipments.int-spec.ts`, E2E |
| 7 | Revisión por rol y actualización de estado y trazabilidad | `e2e/review/embarques-web.mjs`, `docs/23`, `docs/24` |

Hasta que eso exista y esté probado, **P0-029 y P0-017 siguen abiertas**, se decida lo que se decida.

## 7. Qué NO cambia esta decisión

- La conclusión regulatoria sigue `UNDETERMINED` por `CHECK`.
- `READY` del expediente sigue bloqueado por **D-05.B**, **D-07.5**, **D-07.6**, **P1-005** y **D-09.B**.
- Las llamadas satelitales siguen deshabilitadas.
- `EXPORTED` sigue significando «se descargó el paquete», no «se presentó una DDS».

---

## 8. Las seis preguntas que hay que responder antes de adoptar B

La revisión 1 recomendaba B y dejaba su pieza central —«el régimen del destino es declarado y auditado»— como
una frase, no como un mecanismo. Mientras siga siendo una frase, **B es una vía para omitir el paquete mediante
una declaración sin verificar**, que es justo lo que no debe permitir. Estas seis preguntas son el contenido que
le falta. **Ninguna está respondida todavía**: la columna «Respuesta propuesta» es material a decidir, no
adoptado.

| # | Pregunta | Qué dice la revisión 1 | Respuesta propuesta, a decidir |
| --- | --- | --- | --- |
| 1 | **¿Qué dato determina la exigencia del paquete?** | «que el embarque declare un destino sujeto a EUDR» — sin nombrar el dato | Un campo **nuevo y explícito** de régimen declarado (p. ej. `eudr_regime`) con tres valores: `SUBJECT`, `NOT_SUBJECT`, `UNKNOWN`. **No** `destination_country`: el país es indicio y no el criterio jurídico, y además hoy solo se valida su forma —dos letras mayúsculas—, no su pertenencia al catálogo ISO (§9.a) |
| 2 | **¿Quién puede establecerlo y modificarlo?** | No lo dice | Un rol con responsabilidad regulatoria —**no** quien crea el embarque ni quien lo despacha—, y solo mientras el embarque está en `DRAFT`. Tras el despacho es inmutable, como todo lo que el despacho acredita. Cada cambio deja actor, momento y motivo |
| 3 | **¿Qué respaldo requiere?** | «declarado y auditado» | Motivo escrito obligatorio y, para `NOT_SUBJECT`, **evidencia enlazada** (documento o afirmación de evidencia), porque es la declaración que exime del paquete. Declarar `SUBJECT` no necesita respaldo: es la opción que **no** exime |
| 4 | **¿Qué ocurre si es desconocido?** | No lo dice | `UNKNOWN` **no despacha**. Es la postura del proyecto: «origen desconocido y datos faltantes siguen siendo desconocidos». Desconocido **no** puede comportarse como `NOT_SUBJECT`, que es el error que haría inútil toda la compuerta. Valor por defecto: `UNKNOWN` |
| 5 | **¿Cómo se impide omitir el paquete con una declaración sin verificar?** | «queda en el evento de despacho» y «no puede después presentarse como acreditado» | Cuatro cierres a la vez: (a) `NOT_SUBJECT` exige respaldo enlazado (#3); (b) quien lo declara no es quien despacha (#2); (c) el régimen y su respaldo quedan en el evento de despacho y en el expediente, no solo en la fila; (d) un embarque despachado como `NOT_SUBJECT` **no** puede luego exhibirse como acreditado ni entrar en un paquete DD, y el expediente lo declara así explícitamente |
| 6 | **¿Qué hace `dispatch_at` en cada transición?** | «siempre requerido», sin decir respecto de qué | **Obligatorio al quedar `DISPATCHED`, ausente antes**, y sellado por el servidor dentro de la transacción de despacho. Sigue siendo `C`: la condición es de estado. Recorrido completo y redacción de la condición en §8.1 |

### 8.1 `dispatch_at` transición por transición (comportamiento actual, verificado en código)

`shipments.status` tiene **tres** valores: `DRAFT`, `DISPATCHED`, `CANCELLED` (`apps/api/src/db/schema.ts:577`).
No hay estado intermedio de reserva: las reservas viven en `shipment_reservations`
(`ACTIVE`/`RELEASED`/`CONSUMED`).

| Transición | Qué pasa con `dispatch_at` | Quién lo pone |
| --- | --- | --- |
| crear → `DRAFT` | queda `NULL` | nadie; no se acepta del cliente |
| `DRAFT` → `DRAFT` (items, reservas) | sigue `NULL` | — |
| `DRAFT` → **`DISPATCHED`** | se fija a la hora del servidor, junto con `dispatched_by` y `dispatch_operation_id` (`shipments.ts:412`) | **el servidor**, no el cliente |
| `DRAFT` → `CANCELLED` | se queda `NULL` | — |
| desde `DISPATCHED` o `CANCELLED` | **no hay transición**: se rechaza con `409 SHIPMENT_NOT_DRAFT` (`shipments.ts:119`) | — |

**Consecuencia para D-34.** Que lo genere el servidor **no impide que sea condicional**: son dos ejes
independientes —**quién aporta el valor** y **cuándo debe existir**— y confundirlos fue un error de una versión
anterior de esta sección, que proponía reclasificar el campo y quitarle la `C`. No hay que quitársela: **hay que
escribir la condición**, que es justo lo que D-34 debe resolver.

La condición, redactada:

> **`dispatch_at` es obligatorio cuando el embarque queda en `DISPATCHED`, y debe estar ausente antes.**
> Procedencia: **lo sella el servidor** en la misma transacción que efectúa el despacho; **no se acepta del
> cliente** en ninguna petición.

Las dos mitades se comprueban **dentro de la operación**, no exigiéndole al cliente que aporte el sello:

| Qué se comprueba | Dónde |
| --- | --- |
| `status = 'DISPATCHED'` ⟹ `dispatch_at IS NOT NULL` (y `dispatched_by`, `dispatch_operation_id`) | Invariante de la transacción de despacho; verificable además como `CHECK` en la tabla |
| `status <> 'DISPATCHED'` ⟹ `dispatch_at IS NULL` | Lo mismo: `DRAFT` y `CANCELLED` no tienen sello |
| El cliente no puede fijarlo ni alterarlo | Ningún DTO lo acepta; desde `DISPATCHED` no hay transición (`409 SHIPMENT_NOT_DRAFT`) |

Así, `docs/06` conserva la **`C`** y deja de tener la condición sin escribir: la condición es **de estado**, y la
procedencia queda declarada junto a ella. Esto describe el comportamiento que el código ya tiene; **no cambia la
política de despacho**, que sigue bloqueada mientras D-34 no se adopte.

### 8.2 Lo que no se debe hacer, y conviene dejar escrito

- **No clasificar jurídicamente un destino por inferencia.** Ni desde `destination_country`, ni desde el nombre
  del comprador, ni desde una lista interna de países. El régimen es una **declaración de una persona
  responsable**, con su respaldo, o es `UNKNOWN`.
- **No usar datos sintéticos como prueba de aplicabilidad real.** Los embarques DEMO sirven para probar el
  mecanismo —idempotencia, consumo único, bloqueo— y **no** acreditan que una clasificación concreta sea
  correcta en derecho.
- La aplicabilidad jurídica sigue siendo **D-05.B**, y D-34 no la sustituye ni la adelanta.

---

## 9. Dos correcciones de hecho a la revisión 1

**a) El nombre del campo, y el alcance real de su validación.** La revisión 1 dice, en el «En contra» de la
opción B, que «`shipments.destination` es texto declarado, no un país normalizado con régimen». Contrastado: la
columna se llama **`destination_country`**, es `character(2)`, y el lugar libre es otro campo distinto,
`destination_place`.

Pero **la validación no comprueba el catálogo ISO**. El DTO aplica `@Matches(/^[A-Z]{2}$/)`
(`shipments.ts:44`), que exige **dos letras mayúsculas y nada más**: `XX`, `ZZ` y `QQ` pasan igual que `DE`. La
mención de «ISO 3166-1 alfa-2» vive solo en el texto descriptivo del campo (`@ApiProperty({ description: … })`),
que no valida nada. Decir que el campo «está normalizado a ISO» sería **inexacto**: tiene la **forma** de un
código alfa-2, no la pertenencia a su catálogo.

El «En contra» de la revisión 1, por tanto, **se queda corto en vez de pasarse**: a `destination_country` no le
falta solo el régimen, le falta además comprobación contra el catálogo. Son dos carencias, no una.

Y sobre lo que de verdad importa para D-34: el país, por sí solo, **no determina** la aplicabilidad. La determina
la puesta en el mercado de la Unión, de la que el país de destino es indicio. Por eso la respuesta a §8 #1 es un
campo de régimen declarado, y **no** una tabla de países —ni siquiera una validada contra ISO—.

**b) La columna no se llama `dd_package_id`.** En `shipments` la columna real es
**`dd_package_export_id`** (uuid). D-34 y `docs/06_DICCIONARIO_DATOS.md` la nombran `dd_package_id`. Al escribir
la condición hay que unificar el nombre o dejar constancia de la correspondencia, o la condición se escribirá
sobre un campo que no existe.
