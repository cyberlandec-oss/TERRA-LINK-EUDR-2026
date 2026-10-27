# A-03 — Traspaso de custodia entre organizaciones (NÚCLEO OPERATIVO ADOPTADO Y DESARROLLADO, 2026-10-21)

**Estado (2026-10-21): el propietario adoptó el núcleo operativo (§0) y se desarrolló y demostró en local (§12). Sigue PENDIENTE la activación operativa de la salida (D4) y la revisión competente de D2 (§13).** Es una ampliación autorizada (RF-50, `docs/03`) distinta de los criterios
originales, de A-01 y de A-02; no cambia coberturas. Origen: el recorrido integral web (`docs/qa/RECORRIDO_INTEGRAL_WEB_2026-10-21.md`, T15) mostró que la Exportadora tiene 0 lotes y no ve
los de la cooperativa porque la documentación no define cómo pasa un lote de una organización a otra.

## 0. Decisiones del propietario (2026-10-21) — qué quedó adoptado y qué no
Respuesta del propietario al informe con D1–D9. **El propietario corrigió dos puntos de la propuesta**: D4 proponía despachar sin diligencia debida pese a las compuertas vigentes, y D5 convertía cualquier diferencia de peso en pérdida.

| Decisión | Estado | Contenido adoptado |
| --- | --- | --- |
| D1 (b) | **ADOPTADA** | Traspaso de **custodia física**, sin propiedad ni precio |
| D2 | **PENDIENTE de revisión competente** | Solo se implementa una **salvaguarda técnica**: no hay herencia automática de expediente, severidad, conclusión ni aprobación. **No es una determinación jurídica** y no se presenta como tal |
| D3 (b) | **ADOPTADA** para la proyección técnica autorizada | La receptora recibe una **instantánea técnica inmutable, con huella**, del origen declarado; **sin acceso general** al origen del emisor. Ni el consentimiento ni la instantánea prueban origen completo: el lote de la receptora nace con origen INCOMPLETO |
| D4 (a) | **NO ADOPTADA** | Se contrasta con D-34 y las compuertas vigentes. **Mientras no se resuelva, la salida real permanece bloqueada**. No se equipara traspaso con exportación y **no existe un bypass en la API operativa**; las transiciones se demuestran con fixtures y pruebas aisladas |
| D5 (a) | **ADOPTADA con precisiones** | Toda diferencia exige motivo; **diferencia ≠ pérdida**; se distinguen recepción parcial, faltante, sobrante, rechazo y pérdida declarada; una discrepancia pendiente **conserva su estado y cantidad**; no se crean existencias ni se descuentan pérdidas por resta automática; lo ya recibido se devuelve con **otro traspaso vinculado**; el rechazo en tránsito **conserva la procedencia** |
| D6 (a), D7 (a), D8 (a), D9 (b) | **ADOPTADAS** | Vínculo bilateral confirmado; sin compraventa; misma unidad (KG); cada parte ve el estado del traspaso y sus diferencias, no el inventario ajeno |

Lo no adoptado (D2, D4) **no se resuelve aquí**: queda en §13 con su consecuencia técnica.

## 1. Contraste con los flujos de negocio originales
| Fuente | Qué dice del paso entre actores | Consecuencia |
| --- | --- | --- |
| S1 / S4 (workflows) | La plataforma es «multi-organización»; el ejemplo de la Exportadora XYZ muestra **una** organización dueña de productores, parcelas, lotes, entregas y embarques. El comprador (BUYER) recibe un **portal de lectura** | El modelo original opera la cadena **dentro de una organización**; no define el traspaso a otra |
| `docs/14` workflow 6 | «reservar lote → preflight → despachar → **compartir información autorizada**» | «Despachar» es la **salida hacia el comprador** (consume la reserva, termina el rastro operativo); «compartir» es lectura |
| `docs/05` (ERD de custodia) | `RECEPTION → LOT_INPUT → LOT → PROCESS → SHIPMENT_ITEM`, `STOCK_ENTRY` por lote y ubicación | Toda cantidad pertenece a una organización y a una ubicación suya |
| P1-001 / A-02 | Concesión de **lectura** con vencimiento y revocación | No mueve cantidades |
| RF-43 (P1-012) | Precio y pagos **informados**; «no ejecutar transferencias» | La parte económica no ejecuta nada |
| D-05.B (abierta) | Qué actor es cada usuario (operador, comerciante, Art. 2(15)) | Condiciona qué obligaciones de diligencia pasan a quien recibe |

## 2. Tres cosas distintas (no son equivalentes)
| Concepto | Qué es | ¿Mueve cantidades? | ¿Cambia el titular jurídico? | Estado |
| --- | --- | --- | --- | --- |
| **Concesión de lectura** | Una cuenta ve una proyección de un recurso, con vencimiento | No | No | Implementada (P0-003, P1-001, **A-02**) |
| **Transferencia física y cambio de custodia** | La cantidad sale de la custodia de A y entra en la de B, con salida, tránsito y recepción | **Sí**, por movimientos del ledger | No necesariamente | **Esta propuesta** |
| **Compraventa / cambio de propiedad jurídica** | Acuerdo comercial (precio, condiciones, factura) que transfiere la propiedad | No por sí sola | **Sí** | **Fuera de alcance**: un traspaso puede acompañar una venta, pero no la prueba, no la ejecuta ni la sustituye |

## 3. Principios (innegociables)
1. **Ningún `organization_id` cambia** y **no se copia inventario**: toda cantidad cambia solo mediante movimientos trazables del ledger en cada organización.
2. **Conservación de masa entre libros**: `salida de A = entrada en B + en tránsito + pérdida declarada`, comprobable por cada parte con su lado y por una conciliación de plataforma en pruebas.
3. **Origen no inventado**: lo desconocido sigue desconocido; el lote que recibe B solo tiene origen «completo» si B recibió el origen de A bajo consentimiento (§5.4).
4. **Sin elusión de compuertas**: el traspaso no es un camino alterno al despacho ni a READY (§7).
5. **Aceptación del receptor**: nadie recibe lo que no aceptó; nadie transfiere lo que no tiene libre.

## 4. Opciones
- **A. Solo concesiones y documentos (statu quo)**: B ve lo que A concede; B no tiene existencias. Ya existe; no resuelve la cadena cooperativa → exportadora.
- **B. RECOMENDADA — Traspaso de custodia en dos fases con lote espejo y vínculo de linaje**, detallado abajo. Propiedad y precio quedan fuera.
- **C. Traspaso integrado con compraventa (precio, factura, cambio de propiedad)**: requiere decisiones comerciales y jurídicas (D-16, D-05.B, contrato) que hoy no existen; no recomendada ahora.

## 5. Propuesta (opción B)
### 5.1 Actores, relación y permisos
- **Relación entre organizaciones** (`transfer_partners`): vínculo bilateral previo que confirman las dos administraciones. No se elige una organización de una lista ni se enumeran organizaciones; se identifica por un código de relación que A entrega a B fuera de la plataforma, y B lo confirma.
- Permisos nuevos (propuestos): `transfer:read`, `transfer:offer` (A), `transfer:dispatch` (A, distinto de quien ofrece cuando la organización lo exija), `transfer:accept` y `transfer:receive` (B), `transfer:cancel`. Roles: ORG_ADMIN y TRACEABILITY_MANAGER/EXPORT_MANAGER por el lado emisor; ORG_ADMIN, RECEPTION_OPERATOR y TRACEABILITY_MANAGER por el receptor. **Ningún permiso se concede por tener la pantalla.**

### 5.2 Máquina de estados
`DRAFT → OFFERED → ACCEPTED → DISPATCHED (en tránsito) → RECEIVED → CLOSED` con salidas `REJECTED` (B rechaza la oferta), `CANCELLED` (A cancela antes de despachar) y `CLOSED_WITH_DIFFERENCE`.
Cada paso es idempotente (`operation_id`), versionado y auditado en **ambas** organizaciones. Un rechazo posterior a la recepción se resuelve con **otro traspaso de devolución** (B → A), nunca borrando el original.

### 5.3 Cantidades, unidades y movimientos
- Cantidades decimales con unidad explícita; **misma unidad** en origen y destino (sin conversión implícita).
- **Oferta**: reserva en A la cantidad **libre** del lote/centro (usa el ledger de reservas existente; origen de la reserva `CUSTODY_TRANSFER`): no se puede ofrecer lo ya reservado, ni dos veces; cancelar o rechazar libera la reserva.
- **Despacho (A)**: consume la reserva y registra `TRANSFER_OUT` (físico de A → bucket **EN_TRÁNSITO** del traspaso). Saldo negativo imposible.
- **Recepción (B)**: pesaje con el mismo contrato de recepción (método, valor, fecha, responsable); registra `TRANSFER_IN` (EN_TRÁNSITO → físico de B) y **forma un lote de B** (`source = CUSTODY_TRANSFER`) con vínculo de linaje.
- **Diferencias**: recibido ≠ despachado es una **diferencia declarada** con motivo obligatorio (mismas reglas que el cierre de entregas, D-33); una merma en tránsito es un movimiento explícito de pérdida; un exceso exige motivo. El saldo en tránsito no queda abierto: el traspaso se cierra recibido, con diferencia, o devuelto.

### 5.4 Identidad de lotes y origen (sin duplicar existencias)
- El lote de A **sigue existiendo en A** (con menos cantidad); B crea **su propio lote** con otro código. El enlace `custody_lot_links(parent_org, parent_lot, child_org, child_lot, quantity, unit)` conserva la correspondencia sin fusionar identidades ni referencias entre tenants (cada fila lleva y valida los dos `organization_id`).
- **Qué origen recibe B** (decisión D3): por defecto, la **proyección autorizada** que ya existe para concesiones (códigos, estados y agregados; sin identidad ni geometrías), más un **resumen de origen firmado** (huella) del lote de A. Si B necesita geolocalización de parcelas para su propia diligencia, A debe **consentirlo expresamente** como parte del traspaso (instantánea inmutable de origen con huella, revocable solo hacia adelante); sin ese consentimiento el lote de B queda con origen **INCOMPLETO**, y así lo trata el riesgo.
- La atribución proporcional tras mezclas sigue siendo un cálculo etiquetado, no identificación física de un grano.

### 5.5 Documentos
Nota de traspaso/guía y soportes se adjuntan **en cada organización** con el servicio de documentos existente (antimalware, versiones, alcance por titular); ninguna organización accede al documento de la otra salvo concesión. El hash del contenido del traspaso se calcula sobre su cuerpo declarado y se guarda en ambos lados.

### 5.6 Auditoría y eventos
Eventos de dominio y auditoría en **cada** organización (`CustodyTransferOffered/Accepted/Dispatched/Received/Rejected/Cancelled/ClosedWithDifference`) sin datos personales del otro lado; el outbox existente los entrega por organización. Un acceso entre organizaciones queda atribuido a la organización y a la persona que actúa en su propio tenant.

## 6. Qué controles operativos existentes se aplican
- **Reservas y balance de masa** del ledger (P0-017/P0-029): el traspaso las reutiliza; no hay otro libro.
- **Calidad**: no se transfiere un lote con calidad rechazada; la decisión de calidad no viaja como «liberada» para B: B la evalúa con su propia recepción (la de A queda como antecedente declarado, «límites declarados, no verificados»).
- **Compuerta de salida propia** (`TRANSFER_DISPATCH`, KDE a definir como las de recepción y embarque): sin los datos mínimos no se despacha. Es un **dato requerido**, no una aprobación simulada.
- **Origen conocido o declarado** del lote de A: si es INCOMPLETO, el traspaso lo declara y B lo hereda como INCOMPLETO.
- **Tenant y alcance**: ninguna referencia entre tenants sin vínculo explícito; B solo ve su lado y la proyección autorizada del lote de A.

## 7. Cómo se evita usar el traspaso para eludir compuertas
1. **READY y expediente son por organización y por lote**: la instantánea de A no se hereda; B no hereda un «DD aprobado» (que además hoy es inalcanzable por D-05.B/D-07.5/7.6).
2. **El despacho de B** (hacia un comprador o un embarque) exige **su** `DD_PACKAGE`, evidencia y compuerta `SHIPMENT_DISPATCH` sobre **su** lote; un lote recibido con origen INCOMPLETO sigue bloqueando.
3. **El traspaso no cuenta como despacho** ni como «puesta en el mercado»: no genera referencia pública de embarque ni habilita compartir como si fuera uno.
4. La **severidad, la conclusión regulatoria y UNDETERMINED** no se transportan: B las calcula con su catálogo y su perfil jurídico.
5. El **mismo lote no puede estar a la vez reservado para un embarque y ofrecido** en un traspaso (una sola reserva activa por cantidad).

## 8. Plan por fases si se aprueba (cada una, una entrega completa con su validación)
1. Contrato y datos: `transfer_partners`, `custody_transfers`, ítems, enlaces de linaje, bucket en tránsito, movimientos `TRANSFER_OUT/IN`, permisos, eventos, auditoría, conciliación entre libros y pruebas con dos organizaciones reales en PostgreSQL (aislamiento, idempotencia, concurrencia, saldo negativo, masa).
2. Interfaz: relación, oferta, aceptación, despacho, recepción, diferencias y devolución, por rol.
3. Origen compartido con consentimiento (si se decide D3) y su efecto en el riesgo del receptor.
*(Estado original de la propuesta; superado por §0 y §12: el núcleo operativo se desarrolló en una sola entrega completa.)*

## 9. Decisiones D1–D9 (texto original de la propuesta; el estado vigente de cada una está en §0)

**Clasificación.** *Operativa de producto*: la resuelve el propietario del producto. *Regulatoria*: es una conclusión sobre obligaciones jurídicas; **requiere revisión competente** (D-05.B, D-07.5/7.6, perfil jurídico P1-005) y **no se deduce de una decisión de producto**. *Mixta*: parte de producto y parte regulatoria o de privacidad. Aquí solo se describe el efecto técnico de cada opción; **no se adopta ninguna obligación de diligencia**.

### D1 — ¿Debe la plataforma soportar el traspaso de lotes entre organizaciones? *(operativa de producto)*
- **Pregunta**: ¿el paso cooperativa → exportadora es una operación que Terra Link debe registrar con cantidades, tránsito y recepción?
- **Opciones**: (a) No: cada cadena opera dentro de una organización y los terceros reciben lectura por concesión (hoy). (b) Sí, como **custodia física** (sin propiedad ni precio). (c) Sí, integrado con compraventa y cambio de propiedad.
- **Recomendación**: **(b)**. *Fundamento*: resuelve el hueco hallado en el recorrido integral (T15) sin asumir efectos jurídicos ni comerciales que ninguna fuente define; conserva el ledger como único libro.
- **Efecto**: (a) la Exportadora no tiene existencias de lo que recibe. (b) aparecen traspasos, un saldo «en tránsito», lotes de la receptora y enlaces de linaje. (c) añade precio, factura y propiedad (D7).
- **Dependencias**: (b) ninguna regulatoria directa. (c) D7, D-16.
- **Quién resuelve**: propietario del producto.

### D2 — ¿Qué obligaciones de diligencia pasan a quien recibe? *(REGULATORIA — requiere revisión competente)*
- **Pregunta**: ¿el receptor hereda, referencia o ignora el expediente de diligencia del emisor?
- **Opciones**: (a) Nada se hereda: el receptor evalúa con su catálogo y su perfil jurídico. (b) El receptor puede **referenciar** el expediente del emisor como antecedente, sin sustituir el suyo. (c) El expediente del emisor se hereda como propio.
- **Recomendación técnica provisional**: **(a)**, porque es lo que el sistema ya hace sin concluir nada jurídico (la conclusión regulatoria sigue `UNDETERMINED`). **La decisión de fondo no se toma aquí ni se deduce de una decisión de producto.**
- **Efecto**: (a) el receptor no puede despachar sin su propio paquete aprobado (hoy inalcanzable). (b) añade un enlace documental. (c) supondría un efecto jurídico que la plataforma no puede conceder.
- **Dependencias**: D-05.B (qué actor es cada usuario: operador, comerciante, Art. 2(15)), D-07.5/7.6, P1-005.
- **Quién resuelve**: responsable regulatorio / asesoría jurídica competente; el propietario del producto solo registra después la decisión y sus fuentes.

### D3 — ¿Qué origen recibe el receptor? *(mixta: producto + privacidad; puede tener componente regulatorio)*
- **Pregunta**: ¿qué sabe B del origen del lote de A?
- **Opciones**: (a) Nada: el lote de B nace con origen INCOMPLETO. (b) La **proyección agregada** que ya existe para concesiones (códigos, estados, número de productores y parcelas) más un resumen firmado (huella) del lote de A. (c) Una **instantánea inmutable de geolocalización** con consentimiento expreso de A, revocable solo hacia adelante.
- **Recomendación**: **(b)** por defecto; **(c)** solo con consentimiento expreso y tras resolver la salida de geometrías. *Fundamento*: (b) reutiliza una proyección ya aprobada sin sacar coordenadas exactas; (c) es la única que permite origen completo en B, pero exporta datos sensibles.
- **Efecto**: (a) y (b): el lote de B queda con origen INCOMPLETO a efectos de geolocalización (con (b) B ve agregados); su riesgo y su expediente no avanzan. (c): B puede tener origen COMPLETO, y coordenadas exactas salen de A hacia B.
- **Dependencias**: D-14 (salida de geometrías), D-16 (titularidad de datos). Si B necesita la geolocalización por obligación propia, esa parte es regulatoria (D2).
- **Quién resuelve**: propietario del producto con privacidad/jurídico; consentimiento expreso de la organización emisora para (c).

### D4 — ¿Qué exige el emisor para despachar el traspaso? *(mixta)*
- **Pregunta**: ¿qué condiciones debe cumplir el lote de A para salir de su custodia?
- **Opciones**: (a) Calidad no rechazada + datos mínimos del traspaso (compuerta propia `TRANSFER_DISPATCH`, un KDE a definir). (b) Además, origen COMPLETO. (c) Además, **DD aprobado**.
- **Recomendación**: **(a)**; **(c)** solo si una revisión competente concluye que el traspaso equivale a poner el producto en el mercado. *Fundamento*: sin una conclusión jurídica, exigir DD bloquearía todo traspaso mientras el paquete sea inalcanzable, y no exigir nada más no simula aprobaciones.
- **Efecto**: (a) permite mover custodia con los datos mínimos; (b) bloquea lotes con origen incompleto; (c) bloquea todo traspaso hoy.
- **Dependencias**: D-34 (KDE de despacho), D-05.B (si el traspaso es o no «puesta en el mercado»).
- **Quién resuelve**: propietario del producto para (a)/(b); responsable regulatorio para (c).

### D5 — Diferencias de peso, pérdidas en tránsito y devoluciones *(operativa de producto)*
- **Pregunta**: ¿cómo se cierra un traspaso cuando lo recibido difiere de lo despachado?
- **Opciones**: (a) Motivo obligatorio para cualquier diferencia, sin tolerancia (como el cierre de entregas, D-33). (b) Tolerancia configurable por organización. (c) Ajuste automático.
- **Recomendación**: **(a)**; la devolución es **otro traspaso** B → A, nunca un borrado. *Fundamento*: conserva la conservación de masa explícita; (c) la ocultaría.
- **Efecto**: ninguna cantidad queda «perdida»: la diferencia es un movimiento de pérdida declarado con motivo; el traspaso se cierra recibido, con diferencia o devuelto.
- **Dependencias**: D-33.
- **Quién resuelve**: propietario del producto con operaciones de ambas partes.

### D6 — ¿Cómo se identifica a la contraparte? *(operativa de producto + seguridad)*
- **Pregunta**: ¿cómo elige A a B sin poder enumerar organizaciones?
- **Opciones**: (a) **Vínculo bilateral previo** confirmado por ambas administraciones. (b) Código por traspaso. (c) Directorio de organizaciones.
- **Recomendación**: **(a)**. *Fundamento*: igual criterio que A-02 (sin enumeración); deja una relación persistente y auditable.
- **Efecto**: (a) añade una relación entre organizaciones y un paso previo de confirmación; (c) permitiría enumerar organizaciones.
- **Dependencias**: ninguna.
- **Quién resuelve**: propietario del producto.

### D7 — Relación con precio, factura y propiedad *(comercial / jurídica)*
- **Pregunta**: ¿el traspaso modela algo de la compraventa?
- **Opciones**: (a) Fuera: solo una referencia documental opcional. (b) Integrar compraventa (precio, factura, propiedad).
- **Recomendación**: **(a)**. *Fundamento*: RF-43 solo registra precio y pagos *informados* y prohíbe ejecutar transferencias; no hay reglas fiscales ni contrato definidos.
- **Efecto**: (b) exigiría contrato, facturación y reglas de propiedad que no existen.
- **Dependencias**: RF-43 (P1-012), D-16.
- **Quién resuelve**: dirección comercial con asesoría jurídica.

### D8 — Unidades *(operativa técnica)*
- **Pregunta**: ¿se permite cambiar de unidad al traspasar?
- **Opciones**: (a) Misma unidad en origen y destino. (b) Conversión con factor declarado.
- **Recomendación**: **(a)** en esta versión. *Fundamento*: (b) añade una fuente de discrepancias y exige trazar el factor.
- **Efecto**: (a) simplifica la conservación de masa; (b) añade un campo y reglas de redondeo.
- **Dependencias**: catálogo de unidades.
- **Quién resuelve**: propietario del producto con ingeniería de datos.

### D9 — ¿Qué ve el emisor del lote de la receptora? *(operativa / privacidad)*
- **Pregunta**: tras el traspaso, ¿qué información de B conserva A?
- **Opciones**: (a) Nada. (b) Solo el estado del traspaso y sus diferencias. (c) El inventario del receptor.
- **Recomendación**: **(b)**. *Fundamento*: (a) impide cerrar discrepancias; (c) revelaría existencias de otra organización.
- **Efecto**: (b) cada parte ve su propio libro y el estado compartido del traspaso.
- **Dependencias**: ninguna.
- **Quién resuelve**: propietario del producto.

### Resumen
| Tipo | Decisiones | Quién |
| --- | --- | --- |
| Operativas de producto | D1, D5, D6, D8, D9 | Propietario del producto |
| Mixtas (producto + privacidad/regulatorio) | D3, D4 | Producto con privacidad/jurídico; la parte regulatoria, revisión competente |
| Comerciales / jurídicas | D7 | Dirección comercial + asesoría jurídica |
| **Regulatorias (revisión competente)** | **D2** y la parte regulatoria de D3 y D4 | Responsable regulatorio / asesoría competente |

## 10. Ejemplo sintético completo: Cooperativa Río Verde (A) → Exportadora Pacífico (B)
*Datos inventados; **no se registra ningún movimiento operativo**. Muestra qué pasaría con la opción recomendada y qué decisión gobierna cada parte.*

| Paso | Qué ocurre | A (cooperativa) — lote LOT-A-0017, Cacao fermentado, centro DEMO-CA-01 | Tránsito del traspaso | B (exportadora) — centro EXP-BOD-01 | Depende de |
| --- | --- | --- | --- | --- | --- |
| 0 | Estado inicial | físico 450 kg · reservado 0 · disponible 450 | — | sin existencias | — |
| 1 | Vínculo bilateral A↔B confirmado por ambas administraciones | — | — | — | **D6** |
| 2 | A **ofrece** 300 kg (unidad KG) | físico 450 · **reservado 300** · disponible 150 (la reserva sale de lo libre; no se puede ofrecer lo ya reservado) | — | ve la oferta con la proyección del lote | **D1**, D6, **D8**, D3 |
| 3 | B **acepta** los términos (cantidad, unidad, centro de recepción) | sin cambio | — | sin cambio | D1, D6 |
| 4 | A **despacha** (compuerta propia `TRANSFER_DISPATCH`: calidad no rechazada + datos mínimos; sin DD) | consume la reserva: físico **150** · reservado 0 · disponible 150 (`TRANSFER_OUT` 300) | **300 en tránsito** | — | **D4**, D2 (no exige DD) |
| 5 | B **recibe** y pesa: **296,5 kg** (método, valor, fecha, responsable) | sin cambio | 300 − 296,5 = **3,5 pendientes** | `TRANSFER_IN` 296,5: **lote nuevo LOT-B-0041** (`source = CUSTODY_TRANSFER`), físico 296,5 | D1, D8 |
| 6 | **Diferencia** 3,5 kg: B registra el motivo («merma por humedad en tránsito»); se cierra | — | 3,5 → **pérdida declarada** (movimiento con motivo); tránsito = 0 | — | **D5** |
| 7 | Cierre `CLOSED_WITH_DIFFERENCE` | A: lote con 150 kg; ve el estado y la diferencia | 0 | B: 296,5 kg; no ve el inventario de A | **D9** |
| 8 | **Linaje** | `custody_lot_links`: LOT-A-0017 → LOT-B-0041, 296,5 kg KG; pérdida 3,5 kg contra LOT-A-0017 | — | LOT-B-0041 apunta a su lote de origen en A | D1, **D3** |
| 9 | **Origen en B** | — | — | con (a) o (b): origen **INCOMPLETO** a efectos de geolocalización (con (b) ve agregados: nº de productores y parcelas); con (c): COMPLETO si A consintió la instantánea | **D3** (y D2 si B la necesita por obligación propia) |
| 10 | **Qué NO se hereda** | — | — | B no hereda el expediente de A, ni la severidad, ni la conclusión; para despachar necesita **su** DD, que hoy es inalcanzable | **D2** (pendiente de revisión) |
| 11 | **Devolución** (ejemplo): B devuelve 50 kg | recibe como **otro traspaso** B → A (`TRANSFER_OUT` en B, `TRANSFER_IN` en A: lote nuevo en A) | 50 en tránsito hasta recibir | físico 246,5 | D5 |

**Conservación de masa**: 450 = 150 (A) + 300 despachados; 300 = 296,5 (B) + 3,5 (pérdida declarada). Ningún `organization_id` cambia y nada se copia: cada kilo se mueve por un movimiento del ledger de su organización.

## 11. Qué puede desarrollarse sin respuesta y qué necesita respuesta antes de implementar
- **Independiente de A-03 y de D1–D9** (no depende de ninguna decisión; son otras entregas, no se inician aquí): el diagnóstico de rendimiento del entorno de pruebas; el portal del destinatario en inglés (`/compartido`) y rotular el lote en su lista.
- **Necesita respuesta ANTES de crear esquema, API o movimientos** (no se crea nada hasta entonces): **D1** (si se hace o no), **D6** (relación entre organizaciones), **D5** (cierre y diferencias), **D8** (unidades) y **D9** (visibilidad). Con esas cinco adoptadas se puede construir el núcleo operativo (oferta → aceptación → despacho → tránsito → recepción → cierre, con enlaces de linaje y conciliación entre libros).
- **Necesita respuesta para la compuerta de salida y el origen**: **D4** y **D3**. Pueden implementarse con sus opciones por defecto ((a) en D4; (b) en D3) como configuración provisional **sin** concluir nada jurídico.
- **Pendiente de revisión competente, no bloquea el núcleo técnico pero sí cualquier afirmación jurídica**: **D2** (y la parte regulatoria de D3 y D4). Mientras tanto el sistema se comporta como D2 (a): el receptor evalúa por su cuenta, y la conclusión regulatoria sigue `UNDETERMINED`.
- **Fuera de alcance**: **D7** (compraventa).
- **Pruebas de aceptación que ya se pueden redactar** (sin código): los pasos 0–11 del ejemplo como casos de dos organizaciones (aislamiento, idempotencia, concurrencia, saldo negativo, conservación de masa).

**Mientras tanto** la cadena sigue operando dentro de una organización y los terceros reciben lectura por concesión (A-02). Limitaciones documentadas sin convertirlas en entrega: `/compartido` sigue en español (`docs/qa/EVIDENCIA_A02_CONCESIONES_2026-10-21.md` §6) y el diagnóstico de rendimiento del entorno de pruebas sigue pendiente (§2 de la misma evidencia).

## 12. Diseño desarrollado y demostrado en local (núcleo operativo)
**Recorrido**: vínculo bilateral → oferta y reserva → aceptación → salida autorizada → tránsito → recepción (total o parcial) → conciliación de diferencias → cierre, con linaje y auditoría en ambas organizaciones.

| Elemento | Qué es (nombre real) |
| --- | --- |
| Tablas (migración `0058`) | `org_partnerships` (vínculo; un activo por pareja; código solo como huella), `custody_transfers` (traspaso; no cambian organizaciones, lote, cantidad ni unidad), `custody_transfer_steps` (pasos **append-only**; de aquí se **deriva el tránsito**), `custody_discrepancies` (faltante/sobrante con estado y cantidad), `custody_lot_links` (linaje append-only con los dos `organization_id`) |
| Ledger | Movimientos `CUSTODY_RESERVE`, `CUSTODY_RESERVE_RELEASE`, `CUSTODY_OUT`, `CUSTODY_IN`, `CUSTODY_RETURN` (en la propuesta se llamaban `TRANSFER_OUT/IN`); la conciliación del ledger los reconoce. **No hay bucket «en tránsito»**: el tránsito no es saldo de ninguna organización, es `despachado − recibido − devuelto − pérdida confirmada` y la base impide que sea negativo |
| Lote de la receptora | `lots.source = CUSTODY_TRANSFER`: sin entradas de recepción, cerrado a entradas, origen INCOMPLETO (la base impide marcarlo COMPLETO); nace con la primera cantidad recibida |
| Estados | `OFFERED → ACCEPTED → IN_TRANSIT ⇄ WITH_DISCREPANCY → CLOSED`; salidas `REJECTED` (receptora rechaza la oferta) y `CANCELLED` (emisora, antes de la salida). Cierre `COMPLETE` (lo recibido iguala lo despachado) o `WITH_DIFFERENCES` |
| Permisos | `partnership:manage`, `transfer:read`, `transfer:offer`, `transfer:accept`, `transfer:dispatch`, `transfer:receive`, `transfer:resolve` (ver `docs/07`). Cada uno es de **un lado**; ninguno concede lectura del inventario ajeno |
| Compuerta de salida | Proveedor inyectable `TRANSFER_DISPATCH_GATE`, **que BLOQUEA por defecto**. Solo las pruebas la sustituyen (`jest.spyOn`); el E2E construye el estado «en tránsito» con un fixture SQL rotulado |
| Diferencias | Recepción parcial deja el resto **en tránsito** (no es pérdida). Faltante = declaración con motivo; la **pérdida** la confirma la **contraparte** de quien lo declaró. Sobrante = declaración con motivo que **no crea existencias** hasta que la emisora lo confirma; también puede retirarse. Rechazo en tránsito: vuelve al lote y centro de origen de la emisora (`CUSTODY_RETURN`) |
| Devolución | Otro traspaso con `returns_transfer_id`: sale del lote recibido, limitado a lo recibido menos lo ya comprometido; el original no se reabre |
| Visibilidad (D9 b) | Vista por lado: estado, cantidades y diferencias del traspaso; la receptora ve además la instantánea de origen; nadie ve centros, productos ni inventario de la otra |
| Eventos y auditoría | `CustodyTransferOffered/Accepted/Dispatched/Received/Rejected/Cancelled/Closed`, `CustodyShortageDeclared`, `CustodyTransitRejected`, `CustodyDiscrepancyResolved`, `OrgPartnershipProposed/Confirmed/Revoked`, en la organización que actúa; auditoría en ambas |
| Interfaz | `/organizaciones/{id}/traspasos` (vínculos, oferta con revisión previa, lista) y `/traspasos/{id}` (acciones por lado, comprobaciones de salida, cantidades separadas, diferencias, historia); español e inglés, teclado y 390 px |

### 12.1 Desarrollo demostrado (en local; no es activación operativa)
Pruebas de integración (`apps/api/test/custody-transfers.int-spec.ts`, PostgreSQL real, dos organizaciones y una tercera ajena): vínculo (código de un solo uso, no se autoconfirma, un activo por pareja), oferta (reserva sin mover existencia; idempotente; saldo insuficiente; concurrencia: de dos ofertas que no caben una prospera), aceptación/rechazo/cancelación por estado, **salida bloqueada sin bypass** (un cuerpo con banderas de omisión se rechaza), consistencia entre ambos libros (la conciliación de cada organización queda consistente), recepción parcial, faltante, sobrante (confirmado y retirado), rechazo en tránsito, devolución vinculada, permisos y ausencia de filtraciones (el lado se comprueba antes que la versión), append-only e integridad en la base, eventos y auditoría, y convivencia del lote recibido con lotes, saldos, movimientos, riesgo y expediente. E2E (`e2e/tests/traspasos.spec.ts`, 10 pruebas). Validado y desplegado en **`d99f40a`**, demostrado 7/7 en el despliegue y con respaldo verificado: `docs/qa/EVIDENCIA_A03_TRASPASO_2026-10-21.md` (distingue compuerta sustituida en el arnés, servicio y ledger reales bajo esa condición, y estados preparados con fixture SQL).

## 13. Lo que NO está resuelto ni activado
### 13.1 Activación operativa pendiente
- **La salida real de un traspaso permanece bloqueada.** La compuerta `TRANSFER_DISPATCH_GATE` rechaza con `TRANSFER_DISPATCH_BLOCKED`. Hasta resolver D4 y D-34 no existe forma operativa de pasar de `ACCEPTED` a `IN_TRANSIT`; la recepción, el faltante, el sobrante y la conciliación se demuestran sobre un estado de tránsito construido en pruebas.
- Se puede, hoy: proponer y confirmar vínculos, ofrecer (reserva), aceptar, rechazar, cancelar. No se puede, hoy: registrar una salida real.
### 13.2 Decisiones regulatorias sin resolver
- **D2** (qué obligaciones de diligencia pasan a quien recibe): pendiente de revisión competente. El sistema no hereda expediente, severidad, conclusión ni aprobación; es una salvaguarda técnica, no una conclusión jurídica. Dependencias: D-05.B, D-07.5/7.6, P1-005.
- **D4** (condiciones de la salida) y la parte regulatoria de **D3**: sin resolver; la instantánea de origen no acredita origen completo ni cumplimiento.
- La conclusión regulatoria sigue `UNDETERMINED`; un traspaso no es exportación, no es «puesta en el mercado» y no equivale a presentar una DDS.
### 13.3 Limitaciones técnicas conocidas
- El lote recibido tiene origen INCOMPLETO por construcción; no hay camino para completarlo desde el traspaso (D3 c no se adoptó).
- Sin documentos de traspaso específicos (se usa el servicio de documentos de cada organización); sin límites de tolerancia (D5 b no adoptada).
- La conciliación entre los dos libros se prueba en integración; no hay un informe de plataforma entre organizaciones.
