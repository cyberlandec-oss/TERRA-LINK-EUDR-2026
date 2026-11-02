# CTE, KDE y eventos

FUENTE: S1 §§18–29, 54–57. PROPUESTA: contrato de eventos/outbox e integridad concurrente.

## Catálogo operativo

| CTE | KDE mínimos | Actor habitual | Evento propuesto |
| --- | --- | --- | --- |
| HARVEST | Parcela/versión, productor, periodo, producto, cantidad/unidad si medida | Productor/técnico | HarvestRecorded |
| DELIVERY | Proveedor, parcela(s), producto, fecha, peso declarado, soporte | Productor/técnico | DeliveryRegistered |
| RECEPTION | Entrega, centro, receptor, tiempo, peso real, diferencias | Recepción | ReceptionConfirmed |
| WEIGHING | Entidad pesada, método, valor/unidad, fecha, responsable | Recepción | WeightRecorded |
| CLASSIFICATION | Muestra, método, humedad/otros, límites, decisión | Calidad | QualityDecisionRecorded |
| FERMENTATION | Run, inputs, lote(s), tiempos, salida/merma | Trazabilidad/operación | ProcessingRunClosed |
| DRYING | Run, input/output, humedad y pérdida medida | Operación/calidad | ProcessingRunClosed |
| STORAGE | Lote, centro/ubicación, cantidad, entrada/salida, responsable | Operación | StockMovementRecorded |
| PACKAGING | Lote, unidades físicas, peso, fecha, código | Operación | PackagingRecorded |
| SALE | Contraparte, lote/cantidad, moneda/precio si disponible | Gestión/exportación | SaleRecorded |
| SHIPMENT | Embarque, comprador/destino, lotes/cantidades, paquete, despacho | Exportación | ShipmentDispatched |

`CLASSIFICATION` es extensión explícita de los procesos de S1. El CTE define el hecho crítico; KDE define los datos necesarios y su validación. No todo cambio de CRUD es un movimiento de producto.

## Definición KDE

Cada definición guarda `code`, tipo de entidad, unidad/tipo de valor, momento del proceso, condición de obligatoriedad, validación, rol responsable y versión. Ejemplo: `DELIVERY_WEIGHT` exige cantidad positiva y unidad; `PLOT_ID` exige origen válido o estado faltante explícito. Configuración jurídica no se activa sin revisión.

## Envolvente propuesta

```json
{
  "event_id": "<uuid>",
  "organization_id": "<uuid>",
  "event_type": "ReceptionConfirmed",
  "schema_version": 1,
  "aggregate_type": "RECEPTION",
  "aggregate_id": "<uuid>",
  "aggregate_version": 2,
  "actor_id": "<uuid>",
  "occurred_at": "2026-10-09T15:00:00Z",
  "recorded_at": "2026-10-09T15:05:00Z",
  "correlation_id": "<uuid>",
  "causation_id": "<command-or-event-id>",
  "operation_id": "<idempotency-id>",
  "payload": {
    "delivery_id": "<uuid>",
    "quantity_received": "500.000000",
    "unit": "KG",
    "location_id": "<uuid>"
  }
}
```

UUIDs en ejemplos son marcadores de documentación. No son fixtures ejecutables. `occurred_at` del dispositivo puede ser imperfecto; `recorded_at` es del servidor. Conservar zona/offset original cuando ayuda a investigar; alertar desfase sin corregir el hecho silenciosamente.

## Categorías distintas

| Registro | Propósito |
| --- | --- |
| Evento de dominio | Hecho operativo/estado y causalidad |
| Ledger | Efecto cuantitativo de inventario |
| Auditoría | Quién hizo qué, acceso y cambios |
| Job/outbox | Entrega/reintento de tarea técnica |

No usar logs de servidor como única trazabilidad. No convertir esta propuesta de eventos en obligación de event sourcing total; el repositorio puede usar tablas de estado + eventos inmutables, ADR-0003.

## Correcciones y consistencia

`ReceptionCorrected` referencia evento/versión original, motivo, responsable y ajuste de cantidad. Si ya hay descendientes, calcular impacto y bloquear hasta resolverlo. Preservar original; el saldo actual cambia por entradas de corrección. Cierre de proceso guarda ledger, inputs/outputs, eventos y outbox atómicamente.

Unique `(organization_id, operation_id)` para comando idempotente; unique `(organization_id, aggregate_id, aggregate_version)` para orden del agregado. Repetir clave con payload distinto produce conflicto. Publicación al menos una vez, consumo idempotente, retry acotado, DLQ revisable. No asumir orden global entre agregados.

## Eventos de evidencia y diligencia

`DocumentUploaded`, `DocumentScanCompleted`, `EvidenceSubmitted`, `EvidenceVerified`, `EvidenceRejected`, `PlotGeometryVersionCreated`, `SatelliteAnalysisRequested/Completed/Failed`, `RiskAssessmentCreated`, `MitigationEvidenceSubmitted/Verified/Rejected`, `DDPackageApproved/Generated/Exported`, `ShareGranted/Revoked`.

Si el repositorio ya usa nombres como `RunClosed` u `OutputLotMaterialized`, mapearlos sin renombrar por estética. Versionar payload antes de introducir un cambio incompatible.

## Catálogo CTE implementado (P0-013, versión 1.0.0)

Catálogo de sistema versionado (migración 0015). Distinción explícita: **hito definido** (`cte_definitions`), **operación que lo genera** y **evento emitido** (`cte_operation_links`, INTEGRATED/PENDING) y **datos mínimos** (P0-014, pendientes). Las 11 definiciones (10 de S1 §19 + CLASSIFICATION de este documento) tienen su operación **PENDING**: ninguna operación de cosecha, entrega, recepción, pesaje, clasificación, proceso, almacenamiento, envasado, venta o embarque existe todavía. Los eventos existentes (`ProducerCreated`, `PlotGeometryVersionCreated`, `ProductCreated`…) son datos maestros y no se vinculan como hitos.

| CTE | Operación / evento previsto | Historia |
| --- | --- | --- |
| HARVEST | HARVEST_RECORD / HarvestRecorded | Sin asignar (D-33) |
| DELIVERY | DELIVERY_REGISTER / DeliveryRegistered | P0-012 |
| RECEPTION | RECEPTION_CONFIRM / ReceptionConfirmed | P0-012 |
| WEIGHING | WEIGHT_RECORD / WeightRecorded | P0-012 |
| CLASSIFICATION | QUALITY_DECISION / QualityDecisionRecorded | P0-012 |
| FERMENTATION, DRYING | PROCESSING_RUN_CLOSE / ProcessingRunClosed | P0-016 |
| STORAGE | STOCK_MOVEMENT / StockMovementRecorded | P0-017 |
| PACKAGING | PACKAGING_RECORD / PackagingRecorded | Sin asignar (D-33) |
| SALE | SALE_RECORD / SaleRecorded | Sin asignar (D-33) |
| SHIPMENT | SHIPMENT_DISPATCH / ShipmentDispatched | P0-029 |

Cambios: una nueva versión del catálogo crea la versión siguiente de la definición (la anterior queda retirada y resoluble) o retira una definición con motivo. Al integrar una operación se publica una versión con el vínculo INTEGRATED.

## Catálogo KDE implementado (P0-014, versión 1.0.0)

Migración 0016; 62 definiciones sobre las 11 versiones de hito de CTE 1.0.0. Lectura de las fuentes: un dato listado como «KDE mínimo» en la tabla de este documento es **REQUIRED dentro de su hito**, salvo calificador explícito («si medida» → CONDITIONAL; «si disponible» → OPTIONAL). Un campo «C» de docs/06 sin condición escrita se publica como CONDITIONAL con `undefined_in_contract` (no evaluable → bloquea; D-34). La obligatoriedad del **hito** en cada flujo es otra cosa y sigue pendiente (D-33). No hay configuración jurídica activa.

Diferencias registradas en cada definición (campo `difference`), entre ellas: docs/06 `deliveries` sin parcela (docs/09 sí; arreglo tipado propuesto), `production_records` sin productor ni bandera «medida», sin entidad de pesaje, método y límites de calidad con obligatoriedad distinta entre docs/08 y docs/06, unidad de humedad no definida, «operación» y «gestión» como actores que no son roles.

**Servicio de validación** (`traceability/kde-validator.ts`): resultados PRESENT_VALID, PRESENT_INVALID, PRESENT_NOT_VERIFIABLE (referencia a entidad futura), REQUIRED_MISSING, OPTIONAL_MISSING, NOT_APPLICABLE, CONDITION_NOT_EVALUABLE. Ausente = omitido o null; `0`, `false` y `""` son valores presentes validados por tipo. Decimales como texto (hasta 6 decimales), cantidades con unidad explícita (solo KG), sin conversión ni normalización. Condiciones cerradas: `equals`, `present`, `quantities_differ` (misma unidad), `undefined_in_contract`.

**Compuerta para operaciones futuras**: `gate.transition_allowed` es falso si algún dato resulta REQUIRED_MISSING, PRESENT_INVALID, PRESENT_NOT_VERIFIABLE o CONDITION_NOT_EVALUABLE; `gate.outcome` = COMPLETE / INCOMPLETE / INVALID / UNDETERMINED. Una validación contra una versión de hito retirada se rechaza (`CTE_DEFINITION_RETIRED`). **Ninguna compuerta está integrada**: 0 operaciones integradas.

| Hito | KDE | Historia que lo usará | Prueba de integración exigida |
| --- | --- | --- | --- |
| HARVEST | 6 | Sin historia (D-33) | La operación de cosecha rechaza la transición ante cualquier resultado bloqueante |
| DELIVERY | 7 | P0-012 | DELIVERY_REGISTER sin peso declarado, con unidad no KG o con parcela ajena se rechaza; repetición idempotente |
| RECEPTION | 6 | P0-012 | RECEPTION_CONFIRM con diferencia frente al declarado exige causa |
| WEIGHING | 5 | P0-012 | WEIGHT_RECORD sin método, valor o responsable se rechaza |
| CLASSIFICATION | 5 | P0-012 | QUALITY_DECISION «RELEASED» exige versión de límites |
| FERMENTATION, DRYING | 6 + 5 | P0-016 | PROCESSING_RUN_CLOSE sin entradas, salida o merma (0 admitido) se rechaza |
| STORAGE | 5 | P0-017 | STOCK_MOVEMENT sin lote, ubicación, cantidad o dirección se rechaza |
| PACKAGING | 5 | Sin historia (D-33) | — |
| SALE | 5 | Sin historia (D-33) | Precio sin moneda se rechaza |
| SHIPMENT | 7 | P0-029 | SHIPMENT_DISPATCH con condiciones no definidas queda bloqueado hasta D-34 |

## Eventos dentro de la organización (P0-015, implementado)

**Correcciones.** `correction_of_event_id` + `correction_reason` en `domain_events` (migración 0017), protegidos en BD: misma organización y agregado, posterior al corregido, sin autorreferencia (los ciclos son imposibles: solo se referencia un evento ya insertado y la tabla es append-only), motivo obligatorio, un evento corregido una sola vez (para volver a corregir se corrige la última corrección → cadena). El actor sale de la sesión (un `actor_id` en el cuerpo es rechazado).

Se distinguen tres cosas: (1) **registrar** que un evento fue corregido (evento de corrección con `correction_of`), (2) **aplicar** el cambio de dominio (en la misma transacción), (3) **actualizar consumidores/proyecciones** (outbox, al menos una vez, consumo idempotente).

**Contrato de corrección implementado:** `ProducerUpdated` (y sus correcciones) → `ProducerUpdateCorrected` vía `POST /producers/{id}/events/{eventId}/corrections` con `operation_id`, `expected_version`, `reason` y `fields`. Efecto: los campos indicados del productor toman los valores corregidos (nueva versión `CORRECTION` con motivo); evento y versión originales intactos. Solo campos que cambió el evento corregido y que sean descriptivos en claro (nombre, apellido, razón social, comunidad, provincia, cantón, parroquia); la identidad cifrada no se corrige por esta vía. Si un evento posterior volvió a cambiar el campo → 409 `CORRECTION_SUPERSEDED`. Concurrencia: bloqueo del productor + `expected_version` + índice único de corrección. Idempotencia: `operation_id` con huella del contenido (mismo id con otro contenido → 409). **Cualquier otro tipo de evento → 422 `CORRECTION_NOT_SUPPORTED`.** No hay endpoint genérico de eventos. Las correcciones de cantidades, stock o procesos se definirán en sus historias (p. ej. `ReceptionCorrected` en P0-012).

**Historial.** Lista blanca de campos por tipo (`events/event-history.ts`); un tipo desconocido no expone campos. Orden por `aggregate_version` descendente con cursor.

**Entregas.** Token de arrendamiento (fencing): la confirmación y el registro de fallo filtran por el token del reclamo; si otro reclamo tomó la entrega, la transacción del consumidor se revierte (`LEASE_LOST`). Historial de intentos append-only; `last_error` solo con códigos. Reproceso manual de DEAD: misma entrega y evento, recibos intactos, un intento adicional, motivo y auditoría. Garantía: **al menos una vez** con consumo idempotente; no exactamente una vez.

## Implementación vigente (TECH-001, 2026-10-10)

Código: `apps/api/src/events/` y migración `0004_domain_events_outbox`. **No cierra** CTE/KDE, P0-015 (historial causal completo) ni el framework de reglas: es la base técnica que esas historias usarán.

| Elemento del contrato | Implementación |
| --- | --- |
| Envolvente | `domain_events`: `event_id`, `organization_id`, `event_type`, `schema_version`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `actor_id`, `occurred_at`, `recorded_at` (reloj del servidor), `correlation_id` (id de solicitud), `causation_id`, `operation_id`, `payload` |
| Inmutabilidad | Trigger append-only (UPDATE/DELETE rechazados) |
| Orden por agregado | `UNIQUE (organization_id, aggregate_type, aggregate_id, aggregate_version)`; la versión es la `row_version` del agregado |
| Idempotencia de comando | `UNIQUE (organization_id, operation_id)` cuando hay `operation_id` (aún ningún endpoint lo exige; P0-012/P0-023 lo usarán) |
| Outbox | `event_deliveries` (una fila por consumidor suscrito), escrita con el **mismo** `trx` que el cambio de dominio y la auditoría |
| Entrega | **Al menos una vez.** Worker con reclamo `FOR UPDATE SKIP LOCKED` y arrendamiento (`locked_until`); al vencer, otra instancia retoma la entrega. No hay orden global entre agregados |
| Consumo idempotente | `consumer_receipts (consumer, event_id)` + efectos + `DONE` en una transacción; una reentrega encuentra el recibo y no repite efectos |
| Fallos | Reintento con espera exponencial (base 2 s, máx. 15 min); al agotar `OUTBOX_MAX_ATTEMPTS` (8) pasa a `DEAD` con `last_error` saneado (≤300 caracteres). `DEAD` no se reintenta solo: requiere revisión |
| Consumidores en producción | `organization-event-stats` (conteo por tipo) y `producer-status-counts` (productores por estado, `GET …/producers/summary`, consistencia eventual) |
| Proceso | `node dist/worker-main.js` (servicio `worker` del perfil `app`, escalable) |

Eventos emitidos hoy: `ProducerRegistered`, `ProducerUpdated`, `ProducerAssigned`, `ProducerStatusChanged` (schema 1). Payloads sin datos personales: identificadores, código, estados y **nombres** de campos cambiados, nunca sus valores.

**Auditoría frente a eventos:** `audit_logs` responde «quién hizo qué» (incluye accesos denegados, logins y administración) y no alimenta procesos. `domain_events` expresa hechos de dominio para consumidores. Ambos se escriben en la misma transacción; ninguno sustituye al otro. Organizaciones, membresías e invitaciones todavía solo auditan (no emiten eventos de dominio).

Pendientes separados: catálogo CTE/KDE y su validación (doc 08), ledger de inventario (ADR-0003), P0-015 (vista causal de eventos para auditor), framework de reglas (doc 13), DLQ con herramienta de reproceso.

## P0-012 — Operaciones integradas y compuertas por transición (2026-10-10)

CTE 1.1.0: DELIVERY, RECEPTION, WEIGHING y CLASSIFICATION pasan a **INTEGRATED** (versión 2 de cada definición; la 1 sigue resoluble). KDE 1.1.0 republica sus datos sobre esas versiones:

| KDE | Cambio 1.1.0 | Motivo |
| --- | --- | --- |
| DELIVERY_PRODUCTION_PERIOD | `HARVEST_PERIOD` (DAY/MONTH/UNKNOWN), REQUIRED para completitud; UNKNOWN → `DECLARED_UNKNOWN` (pendiente, no válido) | D-34 MVP |
| DELIVERY_SUPPORT | `ENTITY_REF_LIST` de documentos (varios soportes) | D-35 MVP |
| RECEPTION_DIFFERENCE_REASON | condición `undefined_in_contract`: con parciales la diferencia solo se evalúa al cerrar, y el cierre no está definido | D-33 MVP |
| WEIGHING_* | entidad `weighings`; sujeto = recepción | P0-012 |

Compuertas (`kde_transition_gates` 1.1.0, append-only). BLOCKING = presente y válido; PENDING_ALLOWED = si falta o es desconocido queda como pendiente visible (nunca como válido); NOT_EVALUATED = regla no definida, se informa.

| Transición | BLOCKING | PENDING_ALLOWED | NOT_EVALUATED |
| --- | --- | --- | --- |
| DELIVERY_DRAFT_SAVE | proveedor | resto de DELIVERY (un valor presente se valida al guardar) | — |
| DELIVERY_REGISTER | proveedor, producto, fecha, peso declarado | parcelas, soporte, periodo | — |
| RECEPTION_CONFIRM | entrega, centro, receptor (sesión), momento, peso recibido, pesaje (sujeto, método, valor, fecha, responsable) | soporte, periodo, parcelas | diferencia (cierre) |
| QUALITY_DECISION_RECORD | muestra, método, decisión, versión de límites si libera | humedad | — |
| TRACEABILITY_COMPLETENESS | todos los KDE de entrega, recepción y pesaje | — | diferencia |
| DOWNSTREAM_READINESS | — | — | lotes/procesamiento/inventario (P0-016/017) |

Eventos emitidos (misma transacción que dominio, compuerta, outbox y auditoría): `DeliveryRegistered`, `DeliveryCorrected` (correction_of), `ReceptionConfirmed`, `ReceptionCorrected` (correction_of), `WeightRecorded` (uno por pesaje; el corregido enlaza el anterior), `QualityDecisionRecorded` (solo con decisión). El borrador y las muestras sin decisión no emiten eventos (auditoría sí). La recepción **no** crea stock: el ledger es P0-017.

### Contrato de calidad (revisión P0-012, KDE 1.2.0)

`CLASSIFICATION_LIMITS_VERSION` se publica como **«Referencia de límites declarada (no verificada)»**: texto escrito por quien decide; no existe catálogo publicado de parámetros ni límites, el sistema no comprueba la referencia ni contrasta mediciones. La decisión (liberar/rechazar) es humana, con responsable, y **no habilita** operaciones posteriores (`downstream_enablement = NOT_EVALUATED`). Sin parámetros, límites ni tolerancias nuevos.

## P0-016 — Procesos y compuertas (2026-10-10)

CTE 1.2.0: **FERMENTATION → INTEGRATED** (PROCESSING_RUN_CLOSE / ProcessingRunClosed). **DRYING sigue PENDING**: su cierre está bloqueado hasta definir la unidad de humedad (D-32, D-39.3); se integrará por separado cuando su operación pueda demostrarse. KDE 1.3.0 republica FERMENTATION sobre FERMENTATION@2; `lot` y `process_run` pasan a ser referencias verificables. Nuevo modo de compuerta `BLOCKED_PENDING_DECISION`: bloquea la transición aunque los datos estén presentes y no vuelve opcional ningún dato.

| Transición | BLOCKING | PENDING_ALLOWED | Bloqueo por decisión pendiente |
| --- | --- | --- | --- |
| PROCESS_START_FERMENTATION | run, lotes de entrada, inicio | — | — |
| PROCESS_CLOSE_FERMENTATION | run, lotes de entrada, inicio, cierre, salida, merma (0 admitido) | — | — |
| PROCESS_START_DRYING | run, entrada | humedad (se exige al cerrar) | — |
| PROCESS_CLOSE_DRYING | run, entrada, salida, pérdida, humedad | — | unidad de humedad (D-32) |

Eventos: `LotCreated`, `LotInputAssigned`, `LotInputReleased`, `LotClosedForInput` (agregado LOT); `ProcessingRunStarted`, `ProcessingRunClosed` (entradas, salidas, pérdida, producto de entrada/salida, rendimiento en masa), `ProcessingRunCancelled` (agregado PROCESS_RUN). Preparar un proceso (DRAFT) solo audita. Balance exacto en KG; la humedad no convierte masas.

## P0-017 — Ledger e integración STORAGE (2026-10-10)

CTE 1.3.0: **STORAGE → INTEGRATED** (STOCK_MOVEMENT / StockMovementRecorded) para merma, traslado, asignación de ubicación y ajuste. KDE 1.4.0 republica STORAGE sobre STORAGE@2; compuerta `STOCK_MOVEMENT` BLOCKING en lote, ubicación, cantidad, dirección (IN/OUT) y responsable (sesión); en un traslado se valida cada línea; al asignar una ubicación pendiente se valida la entrada (la salida es justamente lo pendiente). Recepciones, asignaciones y procesos escriben su efecto en el ledger con sus propios eventos (sin duplicar StockMovementRecorded). Efectos exactos: `docs/decisiones/P0-017-EFECTOS-LEDGER.md`.

### Eventos de P0-020/P0-021

`RiskEvaluationRecorded` (agregado RISK_SUBJECT, con `trigger` si proviene de una mitigación); `MitigationCreated`, `MitigationSupportAdded`, `MitigationSubmitted`, `MitigationVerified`, `MitigationRejected` (agregado MITIGATION). Consumidor `risk-reevaluation` suscrito a `MitigationVerified` (idempotente por `event_id`; omite si ya existe una evaluación posterior al evento).

### Eventos de P0-022

`DdCaseCreated`, `DdSnapshotCaptured` (hash, readiness y estado por requisito), `DdReviewRecorded`, `DdPackageExported` (tipo, hash, redacciones, `submission: NOT_SUBMITTED`); agregado `DD_CASE` con versión creciente bajo bloqueo del expediente.
