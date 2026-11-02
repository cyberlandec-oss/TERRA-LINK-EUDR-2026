# P0-016 Lotes y procesos / P0-017 Inventario — Contrato de implementación PROPUESTO (2026-10-10)

Estado: **PROPUESTA** (se conserva como historia). **2026-10-10: las cuatro decisiones de D-39 fueron ADOPTADAS como reglas provisionales del MVP local** por el responsable de producto, junto con dos correcciones técnicas: el control de ciclos se aplica a toda operación que cree o modifique enlaces (no basta con crear salidas como lotes nuevos) y FERMENTATION y DRYING se integran por separado. No es validación en campo ni aprobación para producción.

Estado original: **PROPUESTA, NO APROBADA**. Las propuestas del responsable de producto (2026-10-10) se recogen como
«propuesta del producto, sin aprobar»; las de este documento como «recomendación técnica». Nada se implementa
hasta la aprobación. No se marca ningún vínculo CTE como integrado antes de que su operación funcione.

Fuentes: backlog P0-016/P0-017 (docs/18), docs/05 (ERD custodia: RECEPTION→LOT_INPUT, PROCESS_RUN, STOCK_ENTRY;
«balance de masa no autoriza mezclar material de origen desconocido»; lote: disponibilidad, estado operativo,
calidad y bloqueo de riesgo son dimensiones distintas), docs/06 (lots, lot_inputs/origin_edges, process_runs,
process_inputs/outputs, stock_entries), docs/07 (roles; recursos `lot / process / stock / shipment`: read, create,
close, adjust, reserve, release_dispatch, dispatch), docs/08 (FERMENTATION/DRYING → PROCESSING_RUN_CLOSE /
ProcessingRunClosed; STORAGE → STOCK_MOVEMENT; KDE 1.0.0 de esos hitos), UX_UI §15, docs/16 QA-06/07.

## 1. Reglas propuestas (fuente · recomendación · estado)

| # | Regla | Fuente | Recomendación | Estado |
| --- | --- | --- | --- | --- |
| R1 | Origen de cantidades: solo **recepciones físicas confirmadas**, por su **peso vigente** (última corrección o el original) | Propuesta del producto; docs/05 RECEPTION→LOT_INPUT; P0-012 (peso vigente) | Aplicar tal cual | Sin aprobar |
| R2 | **Asignaciones parciales** de una recepción a lotes, sin superar lo disponible (vigente − ya asignado) | Propuesta del producto; docs/06 «consumir y materializar una vez» | Aplicar; disponible calculado en el servidor bajo bloqueo (§3) | Sin aprobar |
| R3 | Recepciones parciales de una entrega pueden alimentar lotes **sin esperar el cierre** de la entrega | Propuesta del producto | Aplicar; el cierre y las tolerancias siguen pendientes y no bloquean | Sin aprobar |
| R4 | **Calidad pendiente** se conserva en el lote (y se propaga a las salidas); nunca «liberado por calidad» implícito | Propuesta del producto; docs/05 (dimensiones distintas); revisión P0-012 | Estado de calidad del lote derivado: PENDING_EVALUATION si algún insumo lo está; sin habilitación posterior por texto de límites | Sin aprobar |
| R5 | Referencias exactas: cada asignación guarda recepción, **ajuste/pesaje vigente usado** (id), cantidad y unidad; cada entrada de proceso guarda el lote y su versión | Instrucción 2026-10-10; docs/06 origin_edges (event_id) | Columnas `reception_id`, `weighing_id` (vigente al asignar), `reception_version`; `lot_version` en entradas | Sin aprobar |
| R6 | **Protección de efectos posteriores**: corregir el peso de una recepción se rechaza si la nueva cantidad < lo ya asignado/consumido (y cualquier corrección de una recepción ya asignada) hasta definir la corrección en cascada | Propuesta del producto; docs/08 «si hay descendientes, bloquear hasta resolver» | Recomendación: bloquear **toda** corrección de peso con asignaciones activas (más simple y sin efectos ocultos); liberar la asignación primero (operación explícita) | Sin aprobar |
| R7 | Balance en **KG**: entradas = salidas + pérdidas explícitas (0 admitido); exceso rechazado; sin inferir pérdidas ni tolerancias | Propuesta del producto; UX_UI §15.3 (800 − 750 − 50 = 0); docs/08 KDE (merma ≥ 0) | Igualdad exacta con decimales escalados (como P0-012); unidades distintas → rechazo, sin conversión | Sin aprobar |
| R8 | **Humedad** no convierte masas ni calcula rendimiento | Propuesta del producto; D-32 (unidad indefinida) | Se registra como medición con unidad explícita; rendimiento = salida/entradas en KG, etiquetado como masa, no «base seca» | Sin aprobar |
| R9 | **Origen desconocido**: un lote no mezcla insumos de origen desconocido con insumos de origen conocido | docs/05 («no autoriza mezclar material de origen desconocido») | Recomendación: permitir lotes con insumos de origen faltante solo **sin mezclar**, marcando el lote «origen incompleto»; mezclar queda bloqueado hasta política | **Bloqueante** (§6) |
| R10 | Permisos por acción contrastados con la matriz (§4) | docs/07 | Propuesta abajo; requiere confirmación | Sin aprobar |

## 2. Estados y transiciones

**Lote** (`lots`; docs/05: dimensiones separadas):
- Estado operativo: `OPEN` (recibe asignaciones) → `CLOSED_FOR_INPUT` (ya no recibe; puede consumirse) → `CONSUMED` (derivado: disponible = 0 por consumo total; no un campo editable). `CLOSED` nunca significa saldo cero (docs/05).
- Calidad: derivada (PENDING_EVALUATION / RELEASED / REJECTED por decisión humana; ver R4). Origen: `COMPLETE` / `INCOMPLETE` (R9). Riesgo: fuera de alcance (P0-020).
- Cantidad disponible: **proyección** de asignaciones/consumos (P0-016) y, con P0-017, del ledger; nunca campo libre.

**Asignación recepción → lote** (`lot_inputs`, tipo `RECEPTION`): `ACTIVE` → `RELEASED` (liberación explícita con motivo, solo si el lote no fue consumido por un proceso que la incluya). Inmutable; liberar = fila nueva.

**Proceso** (`process_runs`, tipo `FERMENTATION` | `DRYING`; S1/docs/08): `DRAFT` (entradas propuestas, sin efecto) → `RUNNING` (entradas **reservadas**: disponible del lote baja) → `CLOSED` (consumo definitivo + salidas materializadas + pérdida; atómico e idempotente) · `CANCELLED` (desde DRAFT/RUNNING: libera reservas). Cerrado no se edita; corrección/reapertura = operación explícita futura (UX_UI §15.2), fuera de P0-016 salvo decisión.

Momentos: **reserva** al iniciar (RUNNING); **consumo** al cerrar; **liberación** al cancelar. Las salidas son lotes nuevos (producto de salida declarado, p. ej. CACAO_BABA → CACAO_FERMENTADO), con aristas de origen a cada lote de entrada y su cantidad.

**Grafo**: DAG. Una arista solo apunta de nodos existentes y anteriores; un lote de salida es nuevo, por lo que el ciclo es imposible por construcción; además se valida con consulta recursiva antes de insertar (defensa en profundidad) y una prueba intenta forzar el ciclo.

## 3. Frontera lotes ↔ inventario (sin dependencia circular)

| Capacidad | P0-016 (mínima) | P0-017 (ledger completo) |
| --- | --- | --- |
| Asignar recepción → lote sin superar lo disponible | **Sí** | Reutiliza |
| Reserva y consumo de lotes por un proceso (una vez) | **Sí** (tabla de asignaciones/reservas con restricciones) | Reemplaza la proyección por asientos del ledger |
| Saldo por lote | Proyección `asignado − reservado − consumido` (etiquetada «saldo de procesamiento», no inventario) | Saldo por lote **y ubicación** desde `stock_entries` |
| Traslados, merma fuera de proceso, ajustes con motivo, reserva/despacho a embarque | No | **Sí** |
| Ubicación física del lote | Centro de recepción como referencia, sin movimientos | Movimientos STORAGE |

P0-016 **no** declara inventario implementado ni muestra sumas de recepciones como stock. P0-017 depende de P0-016 (lotes/procesos) y no al revés: P0-016 usa su propia proyección mínima.

**Protección transaccional (P0-016)**, en la misma transacción que dominio, evento, outbox y auditoría:
1. `SELECT … FOR UPDATE` de la(s) recepción(es) / lote(s) fuente en orden determinista (por id) para evitar interbloqueos.
2. Recalcular disponible en el servidor dentro de la transacción (vigente − asignaciones activas, o asignado − reservas/consumos).
3. Insertar asignación/reserva; **restricción de base** como red de seguridad: trigger que rechaza si la suma de asignaciones activas de una recepción supera su peso vigente (y equivalente por lote), para que un error de aplicación no pueda duplicar cantidad.
4. `operation_id` único por organización en asignaciones, inicio y cierre de procesos (reintento devuelve el resultado original; mismo id con otro contenido → 409).
5. Corrección de recepción (P0-012) consulta asignaciones activas bajo el mismo bloqueo (R6).

**Pruebas concurrentes** (PostgreSQL real): dos asignaciones simultáneas que juntas superan lo disponible → una 201, otra 409 `INSUFFICIENT_AVAILABLE`; dos procesos que reservan el mismo lote → uno; doble cierre concurrente del mismo proceso → un solo consumo y una salida; corrección de peso concurrente con asignación → una falla con conflicto, nunca saldo negativo; fallo forzado en auditoría → sin asignación, reserva, salida ni evento.

## 4. Permisos por acción (contraste con docs/07; propuesta)

| Permiso | Roles propuestos | Sustento en la matriz | Duda a confirmar |
| --- | --- | --- | --- |
| `lot:read` | ORG_ADMIN, MANAGER, RECEPTION_OPERATOR, QUALITY_OPERATOR, TRACEABILITY_MANAGER, EUDR_MANAGER, EXPORT_MANAGER, AUDITOR | Lectura de lotes en RECEPTION/QUALITY/TRACEABILITY/EXPORT/AUDITOR | FIELD_TECHNICIAN: sin lectura (no figura) |
| `lot:create` + `lot:assign_input` (asignar recepciones) | ORG_ADMIN, RECEPTION_OPERATOR, TRACEABILITY_MANAGER | RECEPTION «vincular origen/lote»; TRACEABILITY «relación» | ¿MANAGER? |
| `lot:release_input` (liberar asignación, con motivo) | ORG_ADMIN, TRACEABILITY_MANAGER | TRACEABILITY «corrección autorizada» | — |
| `process:create` / `process:start` / `process:close` / `process:cancel` | ORG_ADMIN, TRACEABILITY_MANAGER | TRACEABILITY «procesamiento» | DRYING: docs/08 actor «operación/calidad»; ¿QUALITY_OPERATOR cierra secados? |
| `stock:*` (adjust, move, reserve, dispatch) | P0-017 | docs/07 recursos stock/shipment | Fuera de P0-016 |

Alcance: lotes de la organización (centros asignados sin contrato, igual que P0-012). Sin operaciones entre organizaciones (P0-003).

## 5. Eventos, KDE y demostraciones

| Operación | Evento | KDE / compuerta | CTE |
| --- | --- | --- | --- |
| Crear lote + asignar recepción | `LotCreated`, `LotInputAssigned` (recepción, pesaje vigente, cantidad) | Compuerta propia propuesta `LOT_INPUT_ASSIGN` (recepción confirmada, cantidad ≤ disponible, misma unidad/producto) | Sin CTE (no es hito de S1); docs/05 |
| Liberar asignación | `LotInputReleased` (motivo) | — | — |
| Iniciar proceso (reserva) | `ProcessingRunStarted` | Entradas válidas y disponibles | — |
| Cerrar proceso | `ProcessingRunClosed` (entradas, salidas, pérdida, tipo) | FERMENTATION@1 / DRYING@1 (KDE 1.0.0: run, entradas, inicio, cierre, salida, merma ≥ 0; secado: humedad requerida **sin unidad (D-32)**) | FERMENTATION y DRYING pasan a INTEGRATED **solo** en la versión de catálogo publicada junto con la operación funcionando |
| Cancelar proceso | `ProcessingRunCancelled` | — | — |

**DRYING_MOISTURE** es REQUIRED en KDE 1.0.0 pero su unidad está indefinida (D-32): o se publica una nueva versión que lo trate como pendiente permitido (como el periodo de P0-012), o el cierre de secados queda bloqueado. Es decisión (§6).

Demostraciones (criterios de aceptación propuestos):
- **Transformación de P0-011**: proceso que consume CACAO_BABA y produce CACAO_FERMENTADO con evento y rendimiento en masa (salida/entradas KG); cierra el criterio pendiente de P0-011.
- **FERMENTATION y DRYING**: cierre real con KDE validados → nueva versión CTE con vínculo INTEGRATED; prueba que el catálogo cambia solo entonces.
- **Rollback completo**: fallo forzado en cierre → sin consumo, salida, pérdida, evento ni auditoría.
- **Doble envío / doble consumo**: reintento con mismo `operation_id`; cierres y asignaciones concurrentes (§3).
- **Balance 800 → 750 + 50**: aceptado; 800 → 760 + 50 y 800 → 750 + 60 rechazados (`BALANCE_MISMATCH`); salida > entradas rechazada.
- **Aislamiento y roles**: lote/recepción de otra organización = 404; roles sin permiso 403; consultas upstream/downstream solo muestran nodos legibles **sin conteos ni marcadores de nodos ocultos** (como el grafo de evidencias de P0-019); productores sin `producer:read_identity` aparecen por código.
- **Origen conservado**: consulta upstream de un lote de salida devuelve recepciones → entregas → productores/parcelas con cantidades atribuidas, etiquetando la atribución proporcional como **cálculo** (docs/05).

## 6. Decisiones realmente bloqueantes

1. **R9 Origen desconocido** (docs/05): ¿se permite un lote con insumos de origen faltante (sin mezclar), o se prohíbe? ¿Mezclar se bloquea siempre?
2. **R6 alcance del bloqueo de correcciones**: ¿bloquear toda corrección de peso con asignaciones activas (recomendado) o solo cuando reduce por debajo de lo asignado?
3. **DRYING_MOISTURE sin unidad (D-32)**: ¿pendiente permitido en el cierre de secado (nueva versión KDE) o el secado no se cierra hasta definir la unidad?
4. **Roles de procesamiento** (§4): ¿QUALITY_OPERATOR cierra secados? ¿MANAGER crea lotes?

## 7. Pendientes que NO impiden registrar un proceso (se conservan como tales)

Cierre de entregas y tolerancias (D-33); calidad pendiente (R4); catálogo de límites; asignación de centros; ledger completo, traslados y despacho (P0-017); riesgo y bloqueos (P0-020); concesiones entre organizaciones (P0-003); reapertura/corrección de procesos cerrados.
