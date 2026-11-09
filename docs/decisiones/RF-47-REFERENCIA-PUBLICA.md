# RF-47 — Referencia pública por entidad (`public_reference`)

**Estado: contrato ADOPTADO como provisional para el desarrollo local (2026-10-16) e implementado.**
Fecha: 2026-10-16. Historia asociada: **P1-002**. Clasificación de alcance: **evolución (P1)** —
justificación con cita literal en `docs/03_REQUISITOS.md` §«RF-47: por qué es evolución y no MVP».

> **Qué se adoptó y qué no.** Se adoptan las cinco decisiones de §4, con **emisión automática**. Las cinco son
> **decisiones de diseño**, no conclusiones que la fuente obligue: S1 §49 fija las entidades, el carácter
> optativo («podrá tener») y la prohibición de exponer IDs internos, y **no** dice nada sobre ámbito de
> unicidad, formato, emisión ni resolución. Donde abajo se razona a favor de una opción, se razona sobre
> **conveniencia y riesgo**, no sobre obligación documental.
>
> **RF-47 no cierra RF-33 ni P1-002.** Esta entrega crea identificadores y su resolución autorizada. La
> publicación por audiencias, los QR y las concesiones externas **siguen fuera**, y P1-002 sigue abierta.

Este documento hace el contraste previo que la historia exige **antes de añadir ninguna columna**: qué dice la
fuente, qué identificadores ya existen, cuáles de ellos satisfacen el contrato y qué decisiones de producto
quedan sin definir. No añade columnas ni migraciones.

---

## 1. El texto original, completo

S1 §49, literal y sin recortar:

> **49. QR**
> Agregar QR desde la primera arquitectura aunque no sea obligatorio en el MVP.
> Entidades:
> Producer
> Plot
> Delivery
> Lot
> Package
> Shipment
> Cada una podrá tener:
> `public_reference`
> Nunca exponer directamente IDs internos.

De aquí sale **todo** el contrato, y conviene leer lo que dice con exactitud:

- **Seis entidades nombradas**: Producer, Plot, Delivery, Lot, **Package**, Shipment.
- **«Cada una podrá tener»** — *podrá*, no *tendrá*. La referencia es **optativa por entidad**, no un campo
  obligatorio en las seis tablas.
- **«Nunca exponer directamente IDs internos»** — esta es la única obligación **incondicional** de la sección, y
  no es una capacidad que entregar: es una restricción sobre cómo se expone lo que ya existe.
- Lo que la fuente **no** dice: ni el ámbito de unicidad, ni el formato, ni quién la emite, ni a qué resuelve,
  ni qué ocurre con las entidades versionadas. Eso es materia de las decisiones de §4.

---

## 2. Qué identificadores existen ya

Las seis entidades **ya tienen** un identificador legible que no es el UUID. Verificado contra la base de
desarrollo el 2026-10-16:

| Entidad de §49 | Tabla | Identificador actual | Origen del valor | Unicidad declarada |
| --- | --- | --- | --- | --- |
| Producer | `producers` | `producer_code` | **Lo escribe el operador** | `UNIQUE (organization_id, producer_code)` |
| Plot | `plots` | `plot_code` | **Lo escribe el operador** | `UNIQUE (organization_id, plot_code)` |
| Delivery | `deliveries` | `delivery_code` | Generado: `ENT-<año>-<5 dígitos>` | `UNIQUE (organization_id, delivery_code)` |
| Lot | `lots` | `lot_code` | Generado: `<tipo>-<año>-<5 dígitos>` | `UNIQUE (organization_id, lot_code)` |
| Shipment | `shipments` | `shipment_code` | Generado: `EMB-<año>-<5 dígitos>` | `UNIQUE (organization_id, shipment_code)` |
| **Package** | **no existe** | — | — | — |

Ninguno de los seis códigos aparece en un DTO de actualización: se fijan al crear y la API no los cambia. Esa
parte del contrato —estabilidad— **ya se cumple**.

**«Package» no tiene entidad.** No hay tabla `packages`. Lo que hay es `dd_cases` (el expediente, con
`case_number` = `DD-<año>-<5 dígitos>`), `dd_snapshots` (la instantánea versionada, con `snapshot_number`),
`dd_exports` (la descarga) y `dd_reviews`. Cuál de ellas es el «Package» de §49 es una decisión, no una lectura.

---

## 3. ¿Sirve el mecanismo existente? Propiedad por propiedad

La historia pide reutilizar lo que ya hay **cuando satisfaga el contrato**. Contrastado:

| Propiedad exigida | `producer_code`, `plot_code` | `delivery_code`, `lot_code`, `shipment_code`, `case_number` |
| --- | --- | --- |
| No es un ID interno | **Sí** | **Sí** |
| Estable durante la vida del registro | **Sí** — no actualizable por la API | **Sí** — no actualizable por la API |
| Único en un ámbito que sirva en público | **No** — solo por organización | **No** — solo por organización |
| No revela datos personales | **No** — es texto libre del operador | Sí |
| No permite enumerar | Sí — no es secuencial | **No** — es secuencial por año |

Dos fallos son decisivos y afectan a las seis entidades:

**a) La unicidad es por organización, no absoluta.** `UNIQUE (organization_id, plot_code)` permite que dos
organizaciones tengan ambas `PAR-001`. Una referencia que se resuelve **sin contexto de organización** —que es lo
que hace un QR escaneado por un tercero— no puede apoyarse en un valor único solo dentro del tenant. La
alternativa, llevar la organización en el enlace, reintroduce precisamente el identificador interno que §49
prohíbe exponer.

**b) `producer_code` y `plot_code` son texto libre del operador.** El patrón admitido es
`^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$`: nada impide que una organización registre `producer_code = '1712345678'`,
es decir, una cédula. Publicar ese valor convertiría la referencia pública en una vía de divulgación de
identidad, contra RNF-07 y contra el cifrado de identidad que D-43 acaba de reforzar. **Un código que el
operador elige no puede ser, por construcción, un valor publicable.**

Un fallo adicional afecta a los generados: **`ENT-2026-00001` es secuencial**. Publicado, revela el volumen de
operación de la organización y permite tantear referencias contiguas.

**Conclusión del contraste: el mecanismo existente no satisface el contrato.** `public_reference` tiene que ser
un valor nuevo y distinto de los códigos operativos, no un alias de ellos. Los códigos siguen siendo los
identificadores **internos y de operación**; la referencia pública es otra cosa y debe convivir con ellos.

---

## 4. Decisiones de producto que el contrato deja sin definir

El contrato es explícito en lo que pide y mudo en lo que sigue. **Estas cinco decisiones se presentan antes de
implementar, no después**, porque cada una cambia el esquema o el comportamiento:

### D-47.1 — Ámbito de unicidad

| Opción | Qué hace |
| --- | --- |
| **A** | **Única de forma absoluta**, en un espacio de nombres compartido por todos los tipos que usan el resolver |
| **B** | Única por organización. El enlace debe identificar también la organización |

**Adoptada: A.** **Es una elección de diseño, no la única solución posible.** La corrección que hay que dejar
escrita: **B no obliga necesariamente a revelar el UUID interno de la organización** —podría llevar una
referencia externa de organización, también opaca—, así que el argumento de «B expone IDs internos» era
demasiado fuerte. Se adopta A porque resuelve con una sola búsqueda y sin un segundo identificador que acuñar,
mantener y resolver, no porque B fuese inadmisible.

**Lo que sí es un requisito técnico, y no una preferencia:** si las seis entidades se resuelven por la **misma
ruta**, la unicidad tiene que ser **efectiva entre tipos**. Un `UNIQUE` independiente en cada tabla **no lo
garantiza**: cada restricción solo mira su propia tabla, de modo que una parcela y un lote podrían recibir el
mismo valor y el resolver tendría dos candidatos. Por eso la implementación **no añade una columna por tabla**,
sino un **registro central** (`public_references`) donde `reference` es la clave primaria: un único espacio de
nombres para los seis tipos y las dos organizaciones. **Coste de A**: el valor necesita entropía suficiente para
no colisionar ni ser adivinable; son 96 bits (24 hexadecimales) de `gen_random_bytes`.

### D-47.2 — Qué entidad es «Package»

| Opción | Qué hace |
| --- | --- |
| **A** | `dd_cases` — el expediente, uno por lote |
| **B** | `dd_snapshots` — la instantánea versionada, con su versión y su hash |
| **C** | `dd_exports` — la descarga concreta |

**Recomendación: B.** **Efecto:** una referencia pública debe apuntar a algo **inmutable y comprobable**, y la
instantánea ya lo es: `docs/06` le exige `snapshot_version/hash R`. El expediente (A) es un proceso vivo cuyo
`readiness` cambia, así que la misma referencia significaría cosas distintas según cuándo se resuelva. La
descarga (C) es un hecho, no una cosa: habría una referencia nueva por cada descarga del mismo contenido.
**Condición que acompaña a B**: referenciar una instantánea **no** implica que esté aprobada ni que se haya
presentado una DDS; `EXPORTED` sigue significando «se descargó el paquete».

### D-47.3 — A qué resuelve tras una corrección o una versión nueva

| Opción | Qué hace |
| --- | --- |
| **A** | La referencia pertenece a **la entidad** y resuelve a lo vigente |
| **B** | La referencia pertenece a **cada versión** y queda congelada |
| **C** | Ambas: una de entidad y una por versión |

**Recomendación: A para las cinco entidades operativas** (productor, parcela, entrega, lote, embarque).
**Efecto:** RF-47 exige que la referencia **se conserve** tras una corrección, y una referencia de entidad lo
cumple por construcción: la corrección crea un registro nuevo relacionado con el original y la referencia no se
mueve. Con B, un QR ya impreso en una etiqueta de campo quedaría obsoleto en cuanto se corrige una geometría,
que es justo lo contrario de lo que se busca. El historial sigue alcanzable a través de la entidad, con la
autorización de siempre. **Para «Package» no aplica**: si D-47.2 = B, el destino ya es una instantánea inmutable,
de modo que se comporta como una referencia de versión sin necesidad de decidirlo aparte.

### D-47.4 — Emisión: a todas las filas o bajo demanda

| Opción | Qué hace |
| --- | --- |
| **A** | **Automática** para toda fila, incluidos los registros existentes |
| **B** | Bajo demanda, emitida por un rol con permiso, posiblemente revocable |

**Adoptada: A.** **Corrige la recomendación anterior de este documento, que proponía B.** El razonamiento que la
sostenía —que emitir referencias «crea superficie pública por defecto sobre datos de personas»— **confundía dos
cosas**: **crear un identificador no publica los datos ni concede acceso**. Nada queda expuesto por existir una
fila en `public_references`; el acceso lo sigue decidiendo íntegramente la autorización sobre el recurso real
(D-47.5). Los permisos, los estados «con/sin referencia» y las posibles revocaciones que B arrastraba
pertenecen a la **publicación** del pasaporte o del QR —RF-33—, no al identificador.

**Efecto:** la emisión es un disparador por tabla en la base, de modo que **toda vía de alta** queda cubierta
—API, semillas, importación, pruebas— sin que ninguna tenga que acordarse. La **incorporación de los registros
existentes** se hace en la propia migración, con `ON CONFLICT DO NOTHING`, y la migración **comprueba antes de
terminar** que no quedó ninguna fila sin referencia. Sobre «podrá tener» de §49: el carácter optativo se respeta
en lo que importa —nada obliga a *usar* ni a *publicar* la referencia—, y acuñarla siempre es la lectura que
elegimos, no la que la fuente impone.

### D-47.5 — Qué devuelve una resolución no autorizada

| Opción | Qué hace |
| --- | --- |
| **A** | **Indistinguible**: la misma respuesta para «no existe» y «existe pero no te corresponde» |
| **B** | Distingue: `404` si no existe, `403` si existe y no está autorizado |

**Recomendación: A.** **Efecto:** con B, la referencia se convierte en un **oráculo de existencia**: probando
valores se confirma cuáles son válidos, y combinado con cualquier filtración de referencias permite censar
entidades ajenas. A lo impide y mantiene el invariante que importa: **una referencia pública no es un permiso de
acceso.** Conocerla no autoriza nada; la autorización por organización, acción y recurso sigue intacta. **Lo que
esta decisión no cubre**: qué subconjunto se muestra a cada audiencia cuando sí hay autorización, que es RF-33 y
se decide con esa historia.

### Resumen de lo adoptado

| Decisión | Adoptado | Dónde se cumple |
| --- | --- | --- |
| D-47.1 Ámbito | Única **entre todos los tipos que comparten el resolver** | `public_references.reference` es clave primaria |
| D-47.2 «Package» | **`dd_snapshots`**; referenciar no acredita aprobación, vigencia, exportación ni presentación | Tipo `DD_SNAPSHOT` |
| D-47.3 Destino | Referencia estable **de entidad**; la consulta muestra lo vigente | `UNIQUE (entity_type, entity_id)` + append-only |
| D-47.4 Emisión | **Automática**, incluidos los registros existentes | Disparador por tabla + incorporación en la migración |
| D-47.5 No autorizado | **Indistinguible** de inexistente | Una sola respuesta en el resolver |

---

## 5. Lo que sí queda fijado, decida lo que decida el producto

Independientemente de las cinco decisiones, estas condiciones se verificarán en la implementación:

- **Estabilidad**: una vez emitida, la referencia no cambia durante la vida del registro, y ninguna ruta de la
  API la actualiza.
- **Unicidad comprobada en el ámbito que D-47.1 fije**, con restricción en la base y no solo en la aplicación.
- **Incorporación de los registros existentes** sin inventar valores ni reutilizar los códigos operativos.
- **Conservación tras correcciones y versiones nuevas**: una corrección no deja sin referencia al registro ni
  reasigna la que ya tenía.
- **Aislamiento intacto**: la referencia no concede acceso, no cruza organizaciones y no aparece en respuestas
  que el rol no podría ver de todos modos.
- **Sin datos personales en el valor**: la referencia no se deriva de ningún campo de identidad, ni de un hash
  de él (un hash de una cédula es otra vía para confirmarla).

---

## 6. Estado: implementado y probado

| | |
| --- | --- |
| Migración | **`0044_rf47_referencia_publica`** — extensión `pgcrypto`, `public_reference_new()`, tabla `public_references`, append-only, un disparador por tabla e incorporación de los existentes |
| Resolución | `GET /api/v1/public-references/:reference` — `apps/api/src/traceability/public-references.ts` |
| Pruebas | **12** en `apps/api/test/public-references.int-spec.ts`, contra PostgreSQL real |
| Incorporación en desarrollo | **22 referencias**: 9 productores, 6 parcelas, 3 entregas, 3 lotes, 1 instantánea. Ninguna fila sin referencia, ninguna repetida |

Lo que las pruebas fijan: emisión automática y opaca; unicidad efectiva **entre tipos** y entre organizaciones,
con la restricción comprobada de verdad; que no se edita ni se reutiliza; incorporación **idempotente** de
registros existentes; concurrencia (8 altas simultáneas → una referencia cada una, todas distintas); estabilidad
tras corregir un productor y versionar una geometría; permanencia de la referencia de una instantánea anterior
cuando llega otra; que el contenido, el manifiesto y el hash de la instantánea **no cambian**; respuestas
indistinguibles para lo ajeno y lo inexistente; alcance asignado respetado; rol retirado que deja de resolver; y
que sin autenticación no resuelve nada.

### 6.1 El ensayo `down`/`up`: qué demuestra y qué NO

Se ejecutó `down` y luego `up` sobre una **base de ensayo desechable**: `down` retiró la tabla, los seis
disparadores y las tres funciones, y `up` volvió a crearlo todo.

**Eso demuestra reversibilidad del ESQUEMA, y nada más.** No demuestra —ni puede— conservación de los
identificadores: `up` los genera con `gen_random_bytes`, así que un ciclo `down`→`up` **acuña referencias
distintas** y **cualquier enlace ya emitido dejaría de resolver**. Decir «el retorno está probado» sin esta
distinción sería presentar como recuperación completa algo que no lo es.

**Qué exige, por tanto, el retorno operativo de RF-47**: preservar o **restaurar los mismos valores** de
`public_references`. En la práctica eso significa **restaurar desde un respaldo que ya los contenga**, nunca
reconstruir el registro con `up()`. El primer respaldo que los contiene es
**`_respaldos/2026-10-16-post-rf47`** (44 migraciones, 22 referencias): el anterior, `2026-10-16-post-rotacion-pii`,
tiene 43 migraciones y **no los incluye**, de modo que restaurar desde él después de esta entrega perdería todos
los identificadores emitidos.

**`down` no se ejecuta sobre la base de desarrollo.** El ensayo se hizo en una base aparte, creada y eliminada
para ese fin.

**Contrastado en `docs/24`** el 2026-10-16: RF-47 queda **demostrado**. La cobertura del catálogo completo pasa a
**26 de 59 (44,1 %)** —el denominador sube de 58 a 59 porque RF-47 existe—, el alcance MVP se queda en **25 de 43
(58,1 %)** porque RF-47 es P1 y no entra, y el cierre de historias del MVP **sigue en 24 de 32 (75 %)**:
completar una parte de P1-002 no cierra la historia.

**RF-33 y P1-002 siguen abiertas**: esto no las cierra. Falta la publicación por audiencias, el QR y las
concesiones externas.

### Lo que NO cambió

Los códigos operativos (`producer_code`, `plot_code`, `delivery_code`, `lot_code`, `shipment_code`,
`case_number`) se conservan y **ninguna API existente se rediseñó**. No se creó ningún permiso: `BUYER` y
`PRODUCER` siguen sin permisos y `SUPER_ADMIN` sin acceso a datos de organización (D-04 pendiente). Despacho y
`READY` siguen bloqueados, la conclusión sigue `UNDETERMINED` y el satélite deshabilitado. **D-34 sigue sin
adoptar.**
